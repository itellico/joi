#!/usr/bin/env bash
# AutoDev worker — self-healing daemon with restart loop.
# Does NOT use tsx watch (worker imports half the gateway, so any file change
# would restart it — including changes AutoDev itself makes).
set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPTS_DIR")"
RESTART_DELAY=3      # seconds between restarts
MAX_RESTART_DELAY=60  # backoff cap
HEALTHY_THRESHOLD=30  # if process lives this long, reset backoff

# Load .env so worker restarts keep DB/API configuration.
set -a
[ -f "$PROJECT_ROOT/.env" ] && source "$PROJECT_ROOT/.env"
set +a

cd "$PROJECT_ROOT"

delay=$RESTART_DELAY

cleanup() {
  echo ""
  echo "[AutoDev] Shutting down..."
  [ -n "${PID:-}" ] && kill "$PID" 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

while true; do
  # Wait for gateway to be available
  "$SCRIPTS_DIR/wait-for.sh" "127.0.0.1" "3100" "Gateway" 120

  echo "🚀 Starting AutoDev worker..."
  start_time=$(date +%s)

  # Run with plain tsx (no watch) — the worker is a long-running daemon
  pnpm --filter gateway dev:autodev:run &
  PID=$!
  wait "$PID" 2>/dev/null
  exit_code=$?
  PID=""

  elapsed=$(( $(date +%s) - start_time ))

  # If it ran long enough, it was healthy — reset backoff
  if [ "$elapsed" -ge "$HEALTHY_THRESHOLD" ]; then
    delay=$RESTART_DELAY
  fi

  if [ $exit_code -eq 0 ]; then
    echo "[AutoDev] Worker exited cleanly."
    break
  fi

  echo "[AutoDev] Worker crashed (exit $exit_code after ${elapsed}s). Restarting in ${delay}s..."
  sleep "$delay"

  # Exponential backoff
  delay=$(( delay * 2 ))
  [ "$delay" -gt "$MAX_RESTART_DELAY" ] && delay=$MAX_RESTART_DELAY
done
