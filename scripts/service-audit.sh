#!/usr/bin/env bash
# Runtime audit for JOI local services and external dependencies.
# Usage: ./scripts/service-audit.sh
set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPTS_DIR")"
ENV_FILE="$PROJECT_ROOT/.env"

PID_FILE="/tmp/joi-watchdog.pid"
LOCK_DIR="/tmp/joi-watchdog.lock"
STATUS_FILE="/tmp/joi-watchdog.json"
AUTORESTART_FILE="/tmp/joi-watchdog.enabled"

HEALTH_URL="http://127.0.0.1:3100/health"

section() {
  printf "\n=== %s ===\n" "$1"
}

line() {
  printf "%-28s %s\n" "$1" "$2"
}

proc_status() {
  local label="$1" pattern="$2"
  local pids rc
  pids="$(pgrep -f "$pattern" 2>&1)"
  rc=$?
  if [ "$rc" -eq 0 ] && [ -n "$pids" ]; then
    pids="$(echo "$pids" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
    line "$label" "RUNNING (pid: $pids)"
  elif echo "$pids" | grep -qi "operation not permitted"; then
    line "$label" "UNKNOWN (permission denied)"
  else
    line "$label" "DOWN"
  fi
}

watchdog_status() {
  local pid=""
  if [ -f "$PID_FILE" ]; then
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    case "$pid" in
      ''|*[!0-9]*)
        pid=""
        ;;
    esac
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      line "watchdog" "RUNNING (pid: $pid)"
      return
    fi
  fi

  local pids
  pids="$(pgrep -f "watchdog.sh" 2>/dev/null | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  if [ -n "$pids" ]; then
    line "watchdog" "RUNNING (pid: $pids)"
  else
    line "watchdog" "DOWN"
  fi
}

port_status() {
  local label="$1" host="$2" port="$3"
  if [ -z "$host" ] || [ -z "$port" ]; then
    line "$label" "UNKNOWN (missing host/port)"
    return
  fi
  if nc -z -w 2 "$host" "$port" >/dev/null 2>&1; then
    line "$label" "REACHABLE ($host:$port)"
  else
    line "$label" "UNREACHABLE ($host:$port)"
  fi
}

parse_url_host_port() {
  local url="$1" default_port="$2"
  python3 - "$url" "$default_port" <<'PY'
import sys, urllib.parse
url = (sys.argv[1] or "").strip()
default = int(sys.argv[2])
if not url:
    print(" ")
    raise SystemExit(0)
parts = urllib.parse.urlparse(url)
host = parts.hostname or ""
port = parts.port or default
print(f"{host} {port}")
PY
}

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [ -x "$SCRIPTS_DIR/mini-runtime-env.sh" ]; then
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    key="${line%%=*}"
    value="${line#*=}"
    [ -n "$key" ] || continue
    export "$key=$value"
  done < <("$SCRIPTS_DIR/mini-runtime-env.sh" --plain)
fi

read -r DB_HOST DB_PORT <<<"$(parse_url_host_port "${DATABASE_URL:-}" 5432)"
read -r OLLAMA_HOST OLLAMA_PORT <<<"$(parse_url_host_port "${OLLAMA_URL:-}" 11434)"
read -r LIVEKIT_HOST LIVEKIT_PORT <<<"$(parse_url_host_port "${LIVEKIT_URL:-}" 7880)"
read -r REDIS_HOST REDIS_PORT <<<"$(parse_url_host_port "${JOI_TTS_CACHE_REDIS_URL:-}" 6379)"

section "Processes"
watchdog_pattern="$PROJECT_ROOT/scripts/watchdog.sh"
gateway_pattern="$PROJECT_ROOT/gateway.*src/server\\.ts"
web_pattern="$PROJECT_ROOT/web.*vite"
autodev_pattern="$PROJECT_ROOT/gateway.*autodev/worker"
livekit_pattern="$PROJECT_ROOT/infra/livekit-worker"

watchdog_status
proc_status "gateway" "$gateway_pattern"
proc_status "web" "$web_pattern"
autodev_err="$(pgrep -f "$autodev_pattern" 2>&1 || true)"
if pgrep -f "$autodev_pattern" >/dev/null 2>&1; then
  line "autodev worker" "RUNNING"
elif echo "$autodev_err" | grep -qi "operation not permitted"; then
  line "autodev worker" "UNKNOWN (permission denied)"
else
  line "autodev worker" "DOWN"
fi
livekit_err="$(pgrep -f "$livekit_pattern" 2>&1 || true)"
if pgrep -f "$livekit_pattern" >/dev/null 2>&1; then
  line "livekit worker" "RUNNING"
elif echo "$livekit_err" | grep -qi "operation not permitted"; then
  line "livekit worker" "UNKNOWN (permission denied)"
else
  line "livekit worker" "DOWN"
fi

section "Watchdog State Files"
if [ -f "$PID_FILE" ]; then
  line "pid file" "$PID_FILE ($(cat "$PID_FILE" 2>/dev/null || echo unreadable))"
else
  line "pid file" "MISSING"
fi
if [ -d "$LOCK_DIR" ]; then
  line "lock dir" "PRESENT"
  line "lock pid" "$(cat "$LOCK_DIR/pid" 2>/dev/null || echo missing)"
else
  line "lock dir" "MISSING"
fi
if [ -f "$AUTORESTART_FILE" ]; then
  raw_mode="$(tr -d '[:space:]' < "$AUTORESTART_FILE" 2>/dev/null | tr '[:upper:]' '[:lower:]')"
  case "$raw_mode" in
    "0"|"false"|"no"|"off"|"disabled")
      line "auto-restart mode" "PAUSED (from $AUTORESTART_FILE)"
      ;;
    *)
      line "auto-restart mode" "ENABLED (from $AUTORESTART_FILE)"
      ;;
  esac
else
  line "auto-restart mode" "ENABLED (default)"
fi
if [ -f "$STATUS_FILE" ]; then
  now="$(date +%s)"
  mtime="$(date -r "$STATUS_FILE" +%s 2>/dev/null || echo 0)"
  age="$(( now - mtime ))"
  line "status file age" "${age}s"
else
  line "status file" "MISSING"
fi

section "Ports and Dependencies"
port_status "gateway api" "127.0.0.1" "3100"
port_status "web vite" "localhost" "5173"
port_status "postgres" "${DB_HOST:-}" "${DB_PORT:-}"
port_status "ollama" "${OLLAMA_HOST:-}" "${OLLAMA_PORT:-}"
port_status "livekit server" "${LIVEKIT_HOST:-}" "${LIVEKIT_PORT:-}"
port_status "redis" "${REDIS_HOST:-}" "${REDIS_PORT:-}"

section "Runtime Routing"
line "mini mode" "${JOI_MINI_ACTIVE_MODE:-unset}"
line "mini active ip" "${JOI_MINI_ACTIVE_IP:-unset}"
line "mini home ip" "${JOI_MINI_HOME_IP:-unset}"
line "mini road ip" "${JOI_MINI_ROAD_IP:-unset}"
line "webhook home env" "${JOI_WEBHOOK_BASE_URL_HOME:-unset}"
line "webhook road env" "${JOI_WEBHOOK_BASE_URL_ROAD:-unset}"
line "webhook active env" "${JOI_WEBHOOK_BASE_URL:-unset}"

section "Health Endpoint"
if curl -sf -m 6 "$HEALTH_URL" > /tmp/joi-health-audit.json 2>/dev/null; then
  line "/health" "REACHABLE"
  line "/health body" "$(cat /tmp/joi-health-audit.json)"
else
  line "/health" "UNREACHABLE"
fi

section "Webhook Base Resolution"
if curl -sf -m 6 "http://127.0.0.1:3100/api/gateway/webhook-base" > /tmp/joi-webhook-base-audit.json 2>/dev/null; then
  line "/api/gateway/webhook-base" "REACHABLE"
  if command -v jq >/dev/null 2>&1; then
    line "webhook base" "$(jq -r '.webhookBaseUrl // "<none>"' /tmp/joi-webhook-base-audit.json 2>/dev/null)"
    line "source" "$(jq -r '.source // "<none>"' /tmp/joi-webhook-base-audit.json 2>/dev/null)"
    line "mode" "$(jq -r '.networkMode // "<none>"' /tmp/joi-webhook-base-audit.json 2>/dev/null)"
    line "request local" "$(jq -r '.requestIsLocal' /tmp/joi-webhook-base-audit.json 2>/dev/null)"
  else
    line "webhook base body" "$(cat /tmp/joi-webhook-base-audit.json)"
  fi
else
  line "/api/gateway/webhook-base" "UNREACHABLE"
fi

section "Push Status"
if curl -sf -m 6 "http://127.0.0.1:3100/api/push/status" > /tmp/joi-push-status.json 2>/dev/null; then
  line "/api/push/status" "REACHABLE"
  line "push status" "$(cat /tmp/joi-push-status.json)"
else
  line "/api/push/status" "UNREACHABLE"
fi

section "Recent Error Signals"
ERROR_PATTERN="timeout|timed out|econnreset|failed|error|disconnected|crashed|cannot connect"
RECENT_LINES=400
for file in /tmp/joi-watchdog.log /tmp/joi-gateway.log /tmp/joi-autodev.log /tmp/joi-livekit.log; do
  if [ -f "$file" ]; then
    echo "--- $file ---"
    if command -v rg >/dev/null 2>&1; then
      tail -n "$RECENT_LINES" "$file" | rg --text -n -i "$ERROR_PATTERN" | tail -n 8 || tail -n 8 "$file"
    else
      tail -n "$RECENT_LINES" "$file" | grep -a -nEi "$ERROR_PATTERN" | tail -n 8 || tail -n 8 "$file"
    fi
  fi
done
