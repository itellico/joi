#!/usr/bin/env bash
# Start JOI in simulation-safe mode (no channel autostart, no scheduler, safe default execution mode).
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPTS_DIR")"

# Load default env + optional simulation overrides
set -a
[ -f "$PROJECT_ROOT/.env" ] && source "$PROJECT_ROOT/.env"
[ -f "$PROJECT_ROOT/.env.sim" ] && source "$PROJECT_ROOT/.env.sim"
set +a

export JOI_DEFAULT_EXECUTION_MODE="${JOI_DEFAULT_EXECUTION_MODE:-shadow}"
export JOI_DISABLE_CHANNEL_AUTOSTART="${JOI_DISABLE_CHANNEL_AUTOSTART:-1}"
export JOI_DISABLE_SCHEDULER="${JOI_DISABLE_SCHEDULER:-1}"
export JOI_DISABLE_CLOUD_SYNC="${JOI_DISABLE_CLOUD_SYNC:-1}"

if [ -n "${JOI_SHADOW_DATABASE_URL:-}" ]; then
  export DATABASE_URL="$JOI_SHADOW_DATABASE_URL"
fi

if [ -n "${JOI_SIM_GATEWAY_PORT:-}" ]; then
  export GATEWAY_PORT="$JOI_SIM_GATEWAY_PORT"
fi

if [ -z "${VITE_GATEWAY_ORIGIN:-}" ]; then
  export VITE_GATEWAY_ORIGIN="http://127.0.0.1:${GATEWAY_PORT:-3100}"
fi

cleanup() {
  echo ""
  echo "Shutting down simulation stack..."
  kill $(jobs -p) 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "═══════════════════════════════════"
echo "  JOI Simulation Mode"
echo "═══════════════════════════════════"
echo "Execution mode default : $JOI_DEFAULT_EXECUTION_MODE"
echo "Scheduler disabled     : $JOI_DISABLE_SCHEDULER"
echo "Channels disabled      : $JOI_DISABLE_CHANNEL_AUTOSTART"
echo "Cloud sync disabled    : $JOI_DISABLE_CLOUD_SYNC"
echo "Gateway origin         : ${VITE_GATEWAY_ORIGIN}"
if [ -n "${JOI_SHADOW_DATABASE_URL:-}" ]; then
  echo "Database               : JOI_SHADOW_DATABASE_URL"
else
  echo "Database               : DATABASE_URL (.env)"
fi
echo ""

"$SCRIPTS_DIR/dev-gateway.sh" &
"$SCRIPTS_DIR/dev-web.sh" &

wait
