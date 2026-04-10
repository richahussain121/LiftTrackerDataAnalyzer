const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const XLSX = require('xlsx');

const db = require('./db'); // async adapter: libSQL (Turso) or local SQLite

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// --- Schema + seed ---
async function initDatabase() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      email TEXT,
      role TEXT DEFAULT 'member',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      share_token TEXT UNIQUE,
      task_count INTEGER DEFAULT 0,
      check_count INTEGER DEFAULT 0,
      date_range_start TEXT,
      date_range_end TEXT,
      summary_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS analysis_files (
      id TEXT PRIMARY KEY,
      analysis_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      sheet_name TEXT NOT NULL,
      data_type TEXT NOT NULL,
      row_count INTEGER DEFAULT 0,
      raw_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS shared_reports (
      id TEXT PRIMARY KEY,
      analysis_id TEXT NOT NULL,
      shared_by TEXT NOT NULL,
      shared_with_email TEXT,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
    )
  `);

  // Seed default team members if empty
  const row = await db.get('SELECT COUNT(*) AS cnt FROM users');
  const cnt = row ? Number(row.cnt) : 0;
  if (cnt === 0) {
    const seedUsers = [
      { name: 'Richa Hussain', email: 'claude.r.hussain@atlasmobility.com', role: 'admin' },
      { name: 'Team Member', email: '', role: 'member' },
    ];
    for (const u of seedUsers) {
      await db.run('INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)', uuidv4(), u.name, u.email, u.role);
    }
  }
}

// --- Error helper: async route wrapper ---
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --- API Routes ---

// Health check (handy for Render / uptime monitors)
app.get('/api/health', wrap(async (_req, res) => {
  const row = await db.get('SELECT COUNT(*) AS cnt FROM analyses');
  res.json({ ok: true, storage: db.mode, analyses: Number(row?.cnt || 0) });
}));

// Users
app.get('/api/users', wrap(async (_req, res) => {
  const users = await db.all('SELECT id, name, email, role FROM users ORDER BY name');
  res.json(users);
}));

app.post('/api/users', wrap(async (req, res) => {
  const { name, email } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const existing = await db.get('SELECT id FROM users WHERE name = ?', name);
  if (existing) return res.json(existing);
  const id = uuidv4();
  await db.run('INSERT INTO users (id, name, email) VALUES (?, ?, ?)', id, name, email || '');
  res.json({ id, name, email });
}));

// Analyses
app.get('/api/analyses', wrap(async (_req, res) => {
  const analyses = await db.all(`
    SELECT id, title, description, user_name, task_count, check_count,
           date_range_start, date_range_end, share_token, created_at
    FROM analyses ORDER BY created_at DESC
  `);
  res.json(analyses);
}));

app.get('/api/analyses/:id', wrap(async (req, res) => {
  const analysis = await db.get('SELECT * FROM analyses WHERE id = ? OR share_token = ?', req.params.id, req.params.id);
  if (!analysis) return res.status(404).json({ error: 'Analysis not found' });
  const files = await db.all('SELECT id, file_name, sheet_name, data_type, row_count, raw_json FROM analysis_files WHERE analysis_id = ?', analysis.id);
  res.json({ ...analysis, files });
}));

app.post('/api/analyses', wrap(async (req, res) => {
  const { title, description, userId, userName, taskCount, checkCount, dateRangeStart, dateRangeEnd, summaryJson, files } = req.body;
  if (!title || !userName) return res.status(400).json({ error: 'Title and userName required' });

  // Resolve (or auto-heal) the user. Browsers may cache a userId from an older
  // database; if it's not in this DB, fall back to name, then auto-create.
  let resolvedUserId = null;
  if (userId) {
    const byId = await db.get('SELECT id FROM users WHERE id = ?', userId);
    if (byId) resolvedUserId = byId.id;
  }
  if (!resolvedUserId) {
    const byName = await db.get('SELECT id FROM users WHERE name = ?', userName);
    if (byName) {
      resolvedUserId = byName.id;
    } else {
      resolvedUserId = uuidv4();
      await db.run(
        'INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)',
        resolvedUserId, userName, '', 'member'
      );
    }
  }

  const id = uuidv4();
  const shareToken = uuidv4().split('-')[0];
  await db.run(
    `INSERT INTO analyses (id, title, description, user_id, user_name, share_token,
      task_count, check_count, date_range_start, date_range_end, summary_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, title, description || '', resolvedUserId, userName, shareToken,
    taskCount || 0, checkCount || 0, dateRangeStart || '', dateRangeEnd || '', summaryJson || '{}'
  );

  if (files && files.length > 0) {
    for (const f of files) {
      await db.run(
        'INSERT INTO analysis_files (id, analysis_id, file_name, sheet_name, data_type, row_count, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
        uuidv4(), id, f.fileName, f.sheetName, f.dataType, f.rowCount, JSON.stringify(f.data)
      );
    }
  }
  res.json({ id, shareToken, userId: resolvedUserId });
}));

app.delete('/api/analyses/:id', wrap(async (req, res) => {
  // Explicit cascade in case the backend doesn't enforce ON DELETE CASCADE
  await db.run('DELETE FROM analysis_files WHERE analysis_id = ?', req.params.id);
  await db.run('DELETE FROM shared_reports WHERE analysis_id = ?', req.params.id);
  await db.run('DELETE FROM analyses WHERE id = ?', req.params.id);
  res.json({ ok: true });
}));

// File upload & parse (returns parsed data without saving)
app.post('/api/parse', upload.array('files', 20), wrap(async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
  const results = [];
  req.files.forEach((file) => {
    try {
      const wb = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
      wb.SheetNames.forEach((sheetName) => {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
        if (rows.length > 0) {
          results.push({ fileName: file.originalname, sheetName, rowCount: rows.length, headers: Object.keys(rows[0]), sampleRows: rows.slice(0, 3) });
        }
      });
    } catch (e) {
      results.push({ fileName: file.originalname, error: e.message });
    }
  });
  res.json(results);
}));

// Share / Email
app.post('/api/share', wrap(async (req, res) => {
  const { analysisId, sharedBy, email, message } = req.body;
  const analysis = await db.get('SELECT id, share_token, title FROM analyses WHERE id = ?', analysisId);
  if (!analysis) return res.status(404).json({ error: 'Analysis not found' });
  const id = uuidv4();
  await db.run(
    'INSERT INTO shared_reports (id, analysis_id, shared_by, shared_with_email, message) VALUES (?, ?, ?, ?, ?)',
    id, analysisId, sharedBy, email || '', message || ''
  );
  const shareUrl = `${req.protocol}://${req.get('host')}/shared/${analysis.share_token}`;

  if (email && process.env.SMTP_HOST) {
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || 587,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'liftracker@atlasmobility.com',
        to: email,
        subject: `LiftTracker Analysis: ${analysis.title}`,
        html: `<p>${sharedBy} shared a LiftTracker analysis with you:</p><p><strong>${analysis.title}</strong></p>${message ? '<p>' + message + '</p>' : ''}<p><a href="${shareUrl}">View Analysis</a></p>`,
      });
    } catch (e) {
      console.log('Email send failed:', e.message);
    }
  }
  res.json({ shareUrl, shareToken: analysis.share_token });
}));

// Export analysis data as Excel
app.get('/api/export/excel/:id', wrap(async (req, res) => {
  const analysis = await db.get('SELECT * FROM analyses WHERE id = ?', req.params.id);
  if (!analysis) return res.status(404).json({ error: 'Not found' });
  const files = await db.all('SELECT * FROM analysis_files WHERE analysis_id = ?', analysis.id);
  const wb = XLSX.utils.book_new();

  // Summary sheet
  const summaryData = JSON.parse(analysis.summary_json || '{}');
  const summaryRows = Object.entries(summaryData).map(([k, v]) => ({ Metric: k, Value: v }));
  if (summaryRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Summary');

  // Data sheets
  files.forEach((f) => {
    try {
      const data = JSON.parse(f.raw_json);
      if (data.length) {
        const name = (f.sheet_name || f.file_name).substring(0, 31);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), name);
      }
    } catch (e) {}
  });

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${analysis.title.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx"`);
  res.send(buf);
}));

// Shared report route (serve the app, it will load via share token)
app.get('/shared/:token', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Catch-all for SPA
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Central error handler (async wrap forwards rejections here)
app.use((err, _req, res, _next) => {
  console.error('API error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// --- Start ---
// verifyConnection() sends a quick test query to Turso with a 10s timeout.
// If it fails, db.js silently switches to local SQLite so the server still boots.
db.verifyConnection()
  .then(() => initDatabase())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n  LiftTracker Task Analyzer`);
      console.log(`  Running at http://localhost:${PORT}`);
      console.log(`  Storage:   ${db.mode}\n`);
    });
  })
  .catch((err) => {
    console.error('FATAL: database initialization failed:', err);
    process.exit(1);
  });
