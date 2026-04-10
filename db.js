// Database adapter — switches between Turso (libSQL) in production and
// better-sqlite3 locally. Both backends speak the same SQL dialect, so
// server.js only has to call three methods: run / get / all.
//
// Env vars (production):
//   TURSO_DATABASE_URL=libsql://<db>-<org>.turso.io
//   TURSO_AUTH_TOKEN=<generated in Turso dashboard>
//
// If either is missing, falls back to ./data/liftracker.db via better-sqlite3.

const path = require('path');
const fs = require('fs');

const rawUrl = (process.env.TURSO_DATABASE_URL || '').trim();
const rawToken = (process.env.TURSO_AUTH_TOKEN || '').trim();

// Reject obvious placeholder/garbage values so a mistyped env var on the host
// falls back cleanly instead of crashing the whole process on boot.
function looksLikeValidLibsqlUrl(u) {
  if (!u) return false;
  if (u.includes(' ')) return false;               // no whitespace
  if (/^the\b/i.test(u)) return false;             // placeholder "the libsql:// URL"
  return /^(libsql|https|http|wss|ws|file):\/\//i.test(u);
}

const WANT_LIBSQL = looksLikeValidLibsqlUrl(rawUrl) && rawToken.length > 0;

let underlying;
let modeLabel;
let usingLibsql = false;

function initLibsql() {
  const { createClient } = require('@libsql/client');
  underlying = createClient({ url: rawUrl, authToken: rawToken });
  modeLabel = 'libsql (Turso)';
  usingLibsql = true;
}

function initLocal() {
  const Database = require('better-sqlite3');
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  underlying = new Database(path.join(dataDir, 'liftracker.db'));
  underlying.pragma('journal_mode = WAL');
  underlying.pragma('foreign_keys = ON');
  modeLabel = 'sqlite (local file)';
  usingLibsql = false;
}

if (WANT_LIBSQL) {
  try {
    initLibsql();
  } catch (err) {
    console.error('[db] Failed to initialize Turso client, falling back to local SQLite.');
    console.error('[db] Reason:', err && err.message ? err.message : err);
    initLocal();
  }
} else {
  if (rawUrl || rawToken) {
    console.warn('[db] TURSO_DATABASE_URL or TURSO_AUTH_TOKEN looks invalid — using local SQLite.');
    console.warn('[db] URL seen: %j  (must start with libsql://)', rawUrl);
  }
  initLocal();
}

// ---- Connection verification (Turso only) ----
// createClient() never actually talks to the server — it only creates an
// in-memory config object. The first real query triggers the network
// connection. If the URL or token is wrong the query will hang forever
// (no built-in timeout), which blocks initDatabase() and prevents the
// Express server from ever starting to listen.
//
// verifyConnection() runs a trivial query with a race-against-timeout.
// If it fails or times out, we tear down the Turso client and switch to
// local SQLite so the service at least starts (data won't persist across
// deploys but the app is usable).

const CONNECT_TIMEOUT_MS = 10000; // 10 seconds

async function verifyConnection() {
  if (!usingLibsql) return; // nothing to verify for local SQLite

  console.log('[db] Verifying Turso connection (timeout: %ds)...', CONNECT_TIMEOUT_MS / 1000);
  console.log('[db] URL: %s', rawUrl.replace(/\/\/(.{6}).*(@.*)/, '//$1***$2')); // mask middle

  try {
    const result = await Promise.race([
      underlying.execute('SELECT 1'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Turso connection timed out after ' + CONNECT_TIMEOUT_MS + 'ms')), CONNECT_TIMEOUT_MS)
      ),
    ]);
    if (result) {
      console.log('[db] Turso connection verified — OK');
    }
  } catch (err) {
    console.error('[db] Turso connection FAILED: %s', err && err.message ? err.message : err);
    console.error('[db] Falling back to local SQLite so the server can still start.');
    console.error('[db] Check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in your Render env vars.');
    try { underlying.close && underlying.close(); } catch (_) {}
    initLocal();
  }
}

// ---- Uniform async API ----

// Execute a multi-statement DDL script (CREATE TABLE ..., etc)
async function exec(sql) {
  if (usingLibsql) {
    // libSQL's execute() runs one statement per call, so split on ';'
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await underlying.execute(stmt);
    }
  } else {
    underlying.exec(sql);
  }
}

// INSERT / UPDATE / DELETE — returns { changes, lastInsertRowid }
async function run(sql, ...params) {
  if (usingLibsql) {
    const res = await underlying.execute({ sql, args: params });
    return { changes: Number(res.rowsAffected || 0), lastInsertRowid: res.lastInsertRowid };
  }
  return underlying.prepare(sql).run(...params);
}

// SELECT returning a single row (or undefined)
async function get(sql, ...params) {
  if (usingLibsql) {
    const res = await underlying.execute({ sql, args: params });
    return res.rows[0] ? normalizeRow(res.rows[0], res.columns) : undefined;
  }
  return underlying.prepare(sql).get(...params);
}

// SELECT returning all rows
async function all(sql, ...params) {
  if (usingLibsql) {
    const res = await underlying.execute({ sql, args: params });
    return res.rows.map((r) => normalizeRow(r, res.columns));
  }
  return underlying.prepare(sql).all(...params);
}

// libSQL's row objects are array-like with named properties attached as
// getters. Convert to plain {col: val} for consistency with better-sqlite3.
function normalizeRow(row, columns) {
  if (!columns) {
    // Fallback: copy enumerable keys
    const out = {};
    for (const k of Object.keys(row)) out[k] = row[k];
    return out;
  }
  const out = {};
  for (let i = 0; i < columns.length; i++) out[columns[i]] = row[i];
  return out;
}

module.exports = { exec, run, get, all, verifyConnection, get mode() { return modeLabel; } };
