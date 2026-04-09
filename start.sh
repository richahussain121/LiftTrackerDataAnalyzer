#!/usr/bin/env bash
# One-shot start script for LiftTracker Task Analyzer (Team Edition)
# Double-click in Finder or run: ./start.sh
set -e
cd "$(dirname "$0")"

echo ""
echo "  LiftTracker Task Analyzer — Team Edition"
echo "  ========================================"
echo ""

# Check Node is installed
if ! command -v node >/dev/null 2>&1; then
  echo "  ERROR: Node.js is not installed."
  echo "  Install it from https://nodejs.org (LTS version), then re-run this script."
  exit 1
fi

NODE_VER=$(node -v)
echo "  Using Node $NODE_VER"

# Install deps only if node_modules is missing or package.json is newer
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "  Installing dependencies (first run only, ~30s)..."
  npm install --no-audit --no-fund
  echo ""
fi

# Ensure data directory exists
mkdir -p data

# Show LAN IP so you can share it with the team
LAN_IP=""
if command -v ipconfig >/dev/null 2>&1; then
  LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
elif command -v hostname >/dev/null 2>&1; then
  LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
fi

PORT_TO_USE="${PORT:-3000}"
echo "  Starting server on port $PORT_TO_USE..."
echo "  Open this in your browser:  http://localhost:$PORT_TO_USE"
if [ -n "$LAN_IP" ]; then
  echo "  Teammates on your network:  http://$LAN_IP:$PORT_TO_USE"
fi
echo ""
echo "  Press Ctrl+C to stop."
echo ""

PORT="$PORT_TO_USE" exec node server.js
