#!/usr/bin/env bash
# Start web frontend after gateway is ready. Safe to run in any order.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPTS_DIR")"

GATEWAY_WAIT_PORT="${GATEWAY_PORT:-${JOI_SIM_GATEWAY_PORT:-3100}}"

"$SCRIPTS_DIR/wait-for.sh" "127.0.0.1" "$GATEWAY_WAIT_PORT" "Gateway" 120

# Kill stale vite processes
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
sleep 0.5

echo "🚀 Starting web frontend..."
cd "$PROJECT_ROOT"
exec pnpm --filter web dev
