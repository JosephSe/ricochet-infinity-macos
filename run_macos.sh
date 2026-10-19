#!/usr/bin/env zsh
set -euo pipefail
cd "$(dirname "$0")"

if [[ "${1:-}" == "--browser" ]]; then
  echo "Starting Ricochet Infinity server on http://127.0.0.1:8765 ..."
  python3 server.py --port 8765 &
  SERVER_PID=$!
  sleep 0.4
  open "http://127.0.0.1:8765/index.html"
  wait $SERVER_PID
else
  echo "Launching native macOS app: Ricochet Infinity.app ..."
  open "Ricochet Infinity.app"
fi
