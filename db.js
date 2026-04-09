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

const USE_LIBSQL = !!(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);

let underlying;
let modeLabel;

if (USE_LIBSQL) {
  // libSQL cloud (Turso) — persistent, survives host restarts
  const { createClient } = require('@libsql/client');
  underlying = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  modeLabel = 'libsql (Turso)';
} else {
  // Local SQLite file — used for dev on your Mac, or any host with a
  // persistent disk mounted at ./data
  const Database = require('better-sqlite3');
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  underlying = new Database(path.join(dataDir, 'liftracker.db'));
  underlying.pragma('journal_mode = WAL');
  underlying.pragma('foreign_keys = ON');
  modeLabel = 'sqlite (local file)';
}

// ---- Uniform async API ----

// Execute a multi-statement DDL script (CREATE TABLE ..., etc)
async function exec(sql) {
  if (USE_LIBSQL) {
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
  if (USE_LIBSQL) {
    const res = await underlying.execute({ sql, args: params });
    return { changes: Number(res.rowsAffected || 0), lastInsertRowid: res.lastInsertRowid };
  }
  return underlying.prepare(sql).run(...params);
}

// SELECT returning a single row (or undefined)
async function get(sql, ...params) {
  if (USE_LIBSQL) {
    const res = await underlying.execute({ sql, args: params });
    return res.rows[0] ? normalizeRow(res.rows[0], res.columns) : undefined;
  }
  return underlying.prepare(sql).get(...params);
}

// SELECT returning all rows
async function all(sql, ...params) {
  if (USE_LIBSQL) {
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

module.exports = { exec, run, get, all, mode: modeLabel };
