#!/usr/bin/env bash
# Start web frontend after gateway is ready. Safe to run in any order.
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPTS_DIR")"

"$SCRIPTS_DIR/wait-for.sh" "127.0.0.1" "3100" "Gateway" 120

# Kill stale vite processes
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
sleep 0.5

echo "🚀 Starting web frontend..."
cd "$PROJECT_ROOT"
exec pnpm --filter web dev
