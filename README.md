# LiftTracker Task Analyzer — Team Edition

A web application that lets a team of mobility technicians, managers, and analysts
upload LiftTracker Excel exports and analyze task trends together. Reports are saved
to a **shared SQLite database** so every team member sees the same analyses, can
load each other's work, and can share read-only links with people outside the team.

Two deployment modes are supported:

1. **Standalone (single user)** — open `LiftTracker_Analyzer_Standalone.html` in any
   browser. All data stays in that browser's IndexedDB. No server, no install, no
   network. Good for a one-person workflow.
2. **Team (multi-user, shared storage)** — run the Node.js server in this folder.
   Everyone on the network points their browser at the same URL and shares one
   database. This is the recommended mode for a team.

The rest of this README is about the team mode.

---

## How the shared storage works

The server is a small Node.js + Express app backed by SQLite. On first start it
creates `data/liftracker.db` and four tables:

- `users` — the team roster (name, email, role). Seeded with Richa as admin on
  first run; everyone else is added automatically the first time they sign in.
- `analyses` — one row per saved report (title, description, owner, task/check
  counts, date range, summary JSON, share token, created_at).
- `analysis_files` — the raw parsed Excel data attached to each analysis so the
  report can be re-rendered verbatim.
- `shared_reports` — a log of every external share link that's been generated.

When a user runs an analysis and clicks **Save Analysis**, the browser POSTs the
parsed task/check data to `/api/analyses`, the server writes it to SQLite in a
single transaction, and every other team member sees the new report in their
Saved Analyses list as soon as they refresh. There is no per-user partitioning —
everyone on the team sees everyone's reports. That's the whole point.

Each saved analysis gets a short unguessable share token. Giving someone the URL
`http://yourhost/shared/<token>` lets them view the report read-only without
signing in. Optional SMTP settings turn the share button into a real email send.

---

## Quick start (run on your Mac for the team)

Open Terminal and run these four commands once:

```bash
cd ~/Documents/LiftTrackerDataAnalyzer/liftracker-app   # or wherever you cloned
npm install            # installs Express, better-sqlite3, etc (~30s)
npm start              # starts the server on port 3000
# leave this terminal open — closing it stops the server
```

Then open **http://localhost:3000** in your browser. To let teammates on the same
Wi-Fi reach it, share your Mac's LAN IP:

```bash
ipconfig getifaddr en0        # e.g. 192.168.1.42
# teammates open http://192.168.1.42:3000
```

On first load you'll see the sign-in screen. Pick your name from the dropdown
(Richa is seeded) or type a new name to join the team. Run an analysis, click
**Save Analysis**, and everyone who signs in afterward will see it in Saved
Analyses.

---

## One-shot start script

For convenience, a `start.sh` script is included. Double-click it in Finder or run:

```bash
./start.sh
```

It runs `npm install` (only if `node_modules` is missing) and then `npm start`.

---

## Deploy to the cloud (for always-on team access)

Running on your Mac works, but your teammates can only reach it when your laptop
is awake and on the network. For always-on access, deploy to a cloud host. The
app is Docker-ready and works on Railway, Render, Fly.io, or any VPS.

### Railway (easiest, free tier)

1. Push the repo to GitHub (already done at
   `github.com/richahussain121/LiftTrackerDataAnalyzer`).
2. Go to [railway.app](https://railway.app), sign in with GitHub.
3. **New Project → Deploy from GitHub repo** → pick LiftTrackerDataAnalyzer.
4. Railway auto-detects Node, runs `npm install` and `npm start`.
5. Under **Variables**, add `PORT=3000`. Under **Settings → Volumes**, mount a
   volume at `/app/data` so the SQLite file survives redeploys.
6. Railway gives you a public URL like `liftracker.up.railway.app`. Share it.

### Docker (any host)

```bash
docker build -t liftracker .
docker run -d --name liftracker -p 3000:3000 \
  -v liftracker-data:/app/data \
  liftracker
```

The named volume `liftracker-data` persists `data/liftracker.db` across container
restarts.

### Render / Fly.io

Both work out of the box with the included `Dockerfile`. Make sure to attach a
persistent volume at `/app/data`, otherwise saved analyses are lost on redeploy.

---

## Environment variables

| Variable    | Default           | Description                                |
|-------------|-------------------|--------------------------------------------|
| `PORT`      | `3000`            | Server port                                |
| `SMTP_HOST` | —                 | SMTP server (enables email share)          |
| `SMTP_PORT` | `587`             | SMTP port                                  |
| `SMTP_USER` | —                 | SMTP username                              |
| `SMTP_PASS` | —                 | SMTP password or app token                 |
| `SMTP_FROM` | `liftracker@atlasmobility.com` | "From" address on share emails |

If `SMTP_HOST` is not set, share-by-email silently degrades to share-by-link.

---

## REST API reference

All endpoints return JSON unless noted.

| Method | Path                       | Purpose                                         |
|--------|----------------------------|-------------------------------------------------|
| GET    | `/api/users`               | List team members                               |
| POST   | `/api/users`               | Add a new team member (body: `{name, email}`)   |
| GET    | `/api/analyses`            | List all saved analyses (newest first)          |
| GET    | `/api/analyses/:id`        | Fetch one analysis incl. raw file data          |
| POST   | `/api/analyses`            | Save a new analysis                             |
| DELETE | `/api/analyses/:id`        | Delete an analysis (cascades to files)          |
| POST   | `/api/parse`               | Upload Excel files and get back parsed rows     |
| POST   | `/api/share`               | Generate/send a share link                      |
| GET    | `/api/export/excel/:id`    | Download an analysis as a multi-sheet .xlsx     |
| GET    | `/shared/:token`           | Public read-only report view                    |

---

## Backup and restore

The whole database is the single file `data/liftracker.db`. To back up:

```bash
cp data/liftracker.db ~/Desktop/liftracker-backup-$(date +%Y%m%d).db
```

To restore, stop the server and copy a backup file back to `data/liftracker.db`.
Because WAL mode is on, also copy `data/liftracker.db-wal` and `data/liftracker.db-shm`
if they exist at backup time.

---

## Troubleshooting

**"Save Analysis" button does nothing.** Open DevTools → Console. The Save flow
now surfaces errors as toasts and logs them with the `showSaveModal error:` or
`doSaveAnalysis error:` prefix. Most common causes: not signed in, server not
running, or network blocked.

**Server won't start — `better-sqlite3` errors.** You're on an unusual CPU
architecture. Run `npm rebuild better-sqlite3` to compile the native module from
source (requires Python and a C compiler).

**Port already in use.** Start with a different port: `PORT=3001 npm start`.

**Data wiped after redeploy.** Your cloud host isn't persisting `data/`. Attach
a volume at `/app/data`.

---

## Tech stack

Backend: Node.js 18+, Express 4, better-sqlite3, Multer, SheetJS, Nodemailer,
uuid. Frontend: vanilla JS, SheetJS, Chart.js 4, html2canvas, jsPDF. Database:
SQLite with WAL mode.
