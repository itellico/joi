#!/usr/bin/env bash
# Start LiveKit voice worker after LiveKit server + gateway are ready.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPTS_DIR")"

normalize_bool_env() {
  local raw="${1:-}"
  raw="$(printf "%s" "$raw" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  case "$raw" in
    1|true|yes|on|enabled) echo "true" ;;
    0|false|no|off|disabled) echo "false" ;;
    *) echo "auto" ;;
  esac
}

should_run_local_livekit_worker() {
  local mode flag host host_short alias mini_name mini_short

  mode="$(printf "%s" "${JOI_LIVEKIT_WORKER_MODE:-auto}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  case "$mode" in
    local|host|enabled) return 0 ;;
    external|remote|container|disabled) return 1 ;;
  esac

  flag="$(normalize_bool_env "${JOI_LIVEKIT_LOCAL_WORKER:-}")"
  [ "$flag" = "true" ] && return 0
  [ "$flag" = "false" ] && return 1

  host="$(hostname 2>/dev/null | tr '[:upper:]' '[:lower:]')"
  host_short="${host%%.*}"
  alias="$(printf "%s" "${JOI_MINI_HOST_ALIAS:-mini}" | tr '[:upper:]' '[:lower:]')"
  mini_name="$(printf "%s" "${JOI_MINI_HOSTNAME:-marcuss-mini}" | tr '[:upper:]' '[:lower:]')"
  mini_short="${mini_name%%.*}"

  [ "$host" = "$alias" ] || [ "$host" = "$mini_name" ] || [ "$host_short" = "$alias" ] || [ "$host_short" = "$mini_short" ]
}

# Load .env to get LIVEKIT_URL
set -a
[ -f "$PROJECT_ROOT/.env" ] && source "$PROJECT_ROOT/.env"
set +a

# Resolve mini alias to active Home/Road IP for this process without requiring /etc/hosts edits.
if [ -x "$SCRIPTS_DIR/mini-runtime-env.sh" ]; then
  eval "$("$SCRIPTS_DIR/mini-runtime-env.sh")"
fi

if ! should_run_local_livekit_worker; then
  echo "Skipping local LiveKit worker on this host (managed externally)."
  exit 0
fi

# Parse LiveKit host/port from LIVEKIT_URL (ws://host:port)
LK_HOST=$(echo "$LIVEKIT_URL" | sed -E 's|wss?://([^:]+):([0-9]+).*|\1|')
LK_PORT=$(echo "$LIVEKIT_URL" | sed -E 's|wss?://([^:]+):([0-9]+).*|\2|')

"$SCRIPTS_DIR/wait-for.sh" "$LK_HOST" "$LK_PORT" "LiveKit" 120
"$SCRIPTS_DIR/wait-for.sh" "127.0.0.1" "3100" "Gateway" 120

echo "🚀 Starting LiveKit voice worker..."
cd "$PROJECT_ROOT/infra/livekit-worker"
exec ./run.sh
