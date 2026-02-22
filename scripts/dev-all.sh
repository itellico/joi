#!/usr/bin/env bash
# Start ALL JOI services in parallel. Each waits for its own dependencies.
# Order doesn't matter — each script has built-in health check loops.
#
# Usage: ./scripts/dev-all.sh              (default full stack: gateway + web + worker + autodev + watchdog)
#        ./scripts/dev-all.sh --lite       (gateway + web only)
#        ./scripts/dev-all.sh --full       (explicit full stack)
#        ./scripts/dev-all.sh --no-watchdog (full stack without watchdog)
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
START_WORKER=true
START_AUTODEV=true
START_WATCHDOG=true

for arg in "$@"; do
  case "$arg" in
    --lite)
      START_WORKER=false
      START_AUTODEV=false
      START_WATCHDOG=false
      ;;
    --full)
      START_WORKER=true
      START_AUTODEV=true
      START_WATCHDOG=true
      ;;
    --no-watchdog)
      START_WATCHDOG=false
      ;;
  esac
done

cleanup() {
  echo ""
  echo "Shutting down all services..."
  kill $(jobs -p) 2>/dev/null || true
  wait 2>/dev/null || true
  echo "All services stopped."
}
trap cleanup EXIT INT TERM

echo "═══════════════════════════════════"
echo "  JOI Development Environment"
echo "═══════════════════════════════════"

# Always start gateway + web
"$SCRIPTS_DIR/dev-gateway.sh" &
"$SCRIPTS_DIR/dev-web.sh" &

# Optional full-stack services
if [ "$START_WORKER" = true ]; then
  "$SCRIPTS_DIR/dev-worker.sh" &
fi
if [ "$START_AUTODEV" = true ]; then
  "$SCRIPTS_DIR/dev-autodev.sh" &
fi
if [ "$START_WATCHDOG" = true ]; then
  "$SCRIPTS_DIR/watchdog.sh" &
fi

echo ""
echo "Services starting... (Ctrl+C to stop all)"
echo "Mode: worker=$START_WORKER autodev=$START_AUTODEV watchdog=$START_WATCHDOG"
echo ""

wait
