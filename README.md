# LiftTracker Task Analyzer - Team Edition

Web application for analyzing mobility technician task trends from LiftTracker exports.

## Quick Start (Local)

```bash
npm install
npm start
# Open http://localhost:3000
```

## Features

- **Multi-file upload** — drag & drop multiple Excel exports at once
- **Auto-detection** — distinguishes task sheets from equipment check sheets
- **Smart header detection** — finds data headers even when they're not on row 1
- **Year tabs** — overview + per-year breakdowns with heatmaps
- **Compare mode** — side-by-side analysis of two data groups
- **Save & load** — persist analyses in a shared SQLite database
- **Export** — PDF (client-side) and Excel downloads
- **Share** — generate shareable links; optionally email reports
- **Team login** — lightweight user selection (no passwords)

## Deploy with Docker

```bash
docker build -t liftracker .
docker run -p 3000:3000 -v liftracker-data:/app/data liftracker
```

## Deploy to Cloud (Railway / Render / Fly.io)

1. Push repo to GitHub
2. Connect to Railway, Render, or Fly.io
3. Set `PORT` env var if needed (defaults to 3000)
4. For email sharing, set these optional env vars:
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

## Environment Variables

| Variable    | Default            | Description              |
|-------------|--------------------|--------------------------|
| PORT        | 3000               | Server port              |
| SMTP_HOST   | —                  | SMTP server for emails   |
| SMTP_PORT   | 587                | SMTP port                |
| SMTP_USER   | —                  | SMTP username            |
| SMTP_PASS   | —                  | SMTP password            |
| SMTP_FROM   | liftracker@...     | Sender email address     |

## Tech Stack

Node.js, Express, SQLite (better-sqlite3), SheetJS, Chart.js, html2canvas, jsPDF
