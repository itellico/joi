#!/usr/bin/env bash
# JOI Watchdog — independent service monitor that runs forever.
# Checks all services every 30s, restarts crashed ones, writes status JSON.
# Zero Node.js dependencies — pure bash + curl.
# Compatible with macOS bash 3.2 (no associative arrays, no flock).
#
# Usage: ./scripts/watchdog.sh
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPTS_DIR")"

load_project_env() {
  if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$PROJECT_ROOT/.env"
    set +a
  fi
}

load_project_env

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

# ── Config ──────────────────────────────────────────────────
CHECK_INTERVAL=30
STATUS_STALE_AFTER=90
PID_FILE="/tmp/joi-watchdog.pid"
LOCK_DIR="/tmp/joi-watchdog.lock"
STATUS_FILE="/tmp/joi-watchdog.json"
AUTORESTART_FILE="/tmp/joi-watchdog.enabled"
LOG_FILE="/tmp/joi-watchdog.log"
LOG_MAX_LINES=10000
LOG_TRIM_TO=5000
HEALTH_TIMEOUT=10
SHUTDOWN_GRACE_SECONDS=8
INITIAL_RESTART_GRACE=45
DEPENDENT_RESTART_GRACE=45

# Lightweight liveness endpoint (no auth, no dependency fan-out).
GATEWAY_URL="http://127.0.0.1:3100/health"
WEB_URL="http://localhost:5173"
GATEWAY_START_SCRIPT="${WATCHDOG_GATEWAY_START_SCRIPT:-dev:nowatch}"

resolve_pnpm_bin() {
  if [ -n "${WATCHDOG_PNPM_BIN:-}" ] && [ -x "${WATCHDOG_PNPM_BIN}" ]; then
    echo "${WATCHDOG_PNPM_BIN}"
    return 0
  fi

  if command -v pnpm >/dev/null 2>&1; then
    command -v pnpm
    return 0
  fi

  local nvm_glob candidate
  nvm_glob="$HOME/.nvm/versions/node"/*/bin/pnpm
  for candidate in $nvm_glob; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

PNPM_BIN="$(resolve_pnpm_bin || true)"

BACKOFF_INITIAL=10
BACKOFF_CAP=300
RESTART_AFTER_FAILURES=4
RESTART_AFTER_FAILURES_WHEN_RUNNING=8
DEPENDENT_RESTART_AFTER_FAILURES=2

# ── Per-service state (plain variables, bash 3.2 compat) ────
gw_failures=0;  gw_backoff=0;  gw_last_restart=0
web_failures=0; web_backoff=0; web_last_restart=0
ad_failures=0;  ad_backoff=0;  ad_last_restart=0
lk_failures=0;  lk_backoff=0;  lk_last_restart=0
last_autorestart_state=""
watchdog_started_at="$(date +%s)"
gw_last_recovered=0
last_initial_grace_state=""
last_dependent_grace_state=""
livekit_local_worker_enabled=0
if should_run_local_livekit_worker; then
  livekit_local_worker_enabled=1
fi

# ── Single-instance lock (atomic mkdir, bash 3.2 compat) ────
INSTANCE_TAG=""

is_watchdog_pid() {
  local pid="$1"
  [ -n "$pid" ] || return 1
  case "$pid" in
    *[!0-9]* ) return 1 ;;
  esac
  kill -0 "$pid" 2>/dev/null || return 1

  local cmd
  cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  case "$cmd" in
    *watchdog.sh*) return 0 ;;
  esac
  return 1
}

is_status_fresh() {
  [ -f "$STATUS_FILE" ] || return 1

  local now mtime
  now="$(date +%s)"
  mtime="$(date -r "$STATUS_FILE" +%s 2>/dev/null || echo 0)"

  [ $(( now - mtime )) -lt "$STATUS_STALE_AFTER" ]
}

is_lock_recent() {
  [ -d "$LOCK_DIR" ] || return 1

  local now mtime
  now="$(date +%s)"
  mtime="$(date -r "$LOCK_DIR" +%s 2>/dev/null || echo 0)"

  [ $(( now - mtime )) -lt "$STATUS_STALE_AFTER" ]
}

acquire_instance_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    INSTANCE_TAG="$$-$(date +%s)"
    echo "$$" > "$LOCK_DIR/pid"
    echo "$INSTANCE_TAG" > "$LOCK_DIR/tag"
    echo "$$" > "$PID_FILE"
    return 0
  fi

  local old_pid
  old_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || cat "$PID_FILE" 2>/dev/null || true)"
  if is_lock_recent; then
    if is_watchdog_pid "$old_pid"; then
      echo "Watchdog already running (PID $old_pid). Exiting." >> "$LOG_FILE"
    else
      echo "Watchdog lock is recent; startup may be in progress. Exiting." >> "$LOG_FILE"
    fi
    exit 0
  fi

  if is_watchdog_pid "$old_pid"; then
    if is_status_fresh; then
      echo "Watchdog already running (PID $old_pid). Exiting." >> "$LOG_FILE"
      exit 0
    fi
    echo "Watchdog PID $old_pid is alive but status is stale. Replacing instance." >> "$LOG_FILE"
    kill "$old_pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$old_pid" 2>/dev/null; then
      kill -9 "$old_pid" 2>/dev/null || true
    fi
  fi

  echo "Removing stale watchdog lock (PID ${old_pid:-unknown})" >> "$LOG_FILE"
  rm -rf "$LOCK_DIR" 2>/dev/null || true
  rm -f "$PID_FILE" 2>/dev/null || true

  if mkdir "$LOCK_DIR" 2>/dev/null; then
    INSTANCE_TAG="$$-$(date +%s)"
    echo "$$" > "$LOCK_DIR/pid"
    echo "$INSTANCE_TAG" > "$LOCK_DIR/tag"
    echo "$$" > "$PID_FILE"
    return 0
  fi

  echo "Failed to acquire watchdog lock. Exiting." >> "$LOG_FILE"
  exit 1
}

cleanup() {
  local owner_pid owner_tag
  owner_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  owner_tag="$(cat "$LOCK_DIR/tag" 2>/dev/null || true)"
  if [ "$owner_pid" = "$$" ] || { [ -n "$INSTANCE_TAG" ] && [ "$owner_tag" = "$INSTANCE_TAG" ]; }; then
    rm -f "$PID_FILE"
    rm -rf "$LOCK_DIR"
  fi
  exit 0
}
trap cleanup EXIT INT TERM

acquire_instance_lock

# ── Logging ─────────────────────────────────────────────────
log() {
  local ts
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "[$ts] $*" >> "$LOG_FILE"
}

rotate_log() {
  local lines
  lines=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)
  # trim whitespace from wc output on macOS
  lines="$(echo "$lines" | tr -d ' ')"
  if [ "$lines" -gt "$LOG_MAX_LINES" ]; then
    tail -n "$LOG_TRIM_TO" "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
    log "Log rotated ($lines -> $LOG_TRIM_TO lines)"
  fi
}

# ── Health checks ───────────────────────────────────────────
check_gateway() {
  # Only check if the gateway process itself is responsive (HTTP liveness).
  # External dependencies (DB, Redis, Ollama) are not the gateway's fault —
  # restarting gateway won't fix a DB on another machine.
  curl -sf -m "$HEALTH_TIMEOUT" "$GATEWAY_URL" >/dev/null 2>&1
}

check_web() {
  curl -sf -m "$HEALTH_TIMEOUT" "$WEB_URL" >/dev/null 2>&1
}

check_autodev() {
  # Process must exist AND gateway must see it as connected.
  # Without the WS check, a zombie worker (alive but disconnected after
  # gateway restart) would appear healthy to pgrep.
  local pids
  pids="$(autodev_pids)"
  [ -n "$pids" ] || return 1
  local resp
  resp=$(curl -sf -m 3 "http://127.0.0.1:3100/api/autodev/status" 2>/dev/null) || return 1
  echo "$resp" | grep -q '"workerConnected":true'
}

check_livekit() {
  [ "$livekit_local_worker_enabled" -eq 1 ] || return 0

  # Process must exist AND its HTTP health server must respond "OK".
  # The LiveKit agents SDK exposes an HTTP health endpoint on a random port.
  # The health port may be on a child process, so check the whole process tree.
  # Also detect "process is unresponsive" in recent logs — the SDK health
  # endpoint returns OK even when job processes are stuck.
  local pids pid port
  pids=$(pgrep -f "agent.py dev") || return 1
  [ -n "$pids" ] || return 1

  # Find the health port across all agent PIDs (parent + children)
  port=""
  for pid in $pids; do
    port=$(lsof -anP -p "$pid" -i TCP -sTCP:LISTEN 2>/dev/null \
      | awk '{print $9}' | grep -oE '[0-9]+$' | head -1)
    [ -n "$port" ] && break
    # Also check children of this PID
    local child_pids
    child_pids=$(pgrep -P "$pid" 2>/dev/null) || true
    for cpid in $child_pids; do
      port=$(lsof -anP -p "$cpid" -i TCP -sTCP:LISTEN 2>/dev/null \
        | awk '{print $9}' | grep -oE '[0-9]+$' | head -1)
      [ -n "$port" ] && break 2
    done
  done

  [ -n "$port" ] || return 1
  curl -sf -m 3 "http://localhost:${port}/" >/dev/null 2>&1 || return 1

  # Check for stuck worker processes: if the log has "process is unresponsive"
  # in the last 2 minutes, consider the agent unhealthy.
  local lk_log="/tmp/joi-livekit-agent.log"
  if [ -f "$lk_log" ]; then
    local now cutoff_ts
    now=$(date +%s)
    cutoff_ts=$(( now - 120 ))
    # Check last 50 lines for recent unresponsive warnings
    if tail -50 "$lk_log" 2>/dev/null | grep -q "process is unresponsive"; then
      local last_line_ts
      last_line_ts=$(stat -f %m "$lk_log" 2>/dev/null || echo 0)
      if [ "$last_line_ts" -ge "$cutoff_ts" ]; then
        log "LiveKit agent health port OK but worker processes are unresponsive"
        return 1
      fi
    fi
  fi
}

gateway_pids() {
  ps -Ao pid=,command= | awk -v root="$PROJECT_ROOT/gateway" '
    index($0, root) {
      if ($0 ~ /src\/server\.ts/ || $0 ~ /dist\/server\.js/) {
        print $1
      }
    }
  ' | awk 'NF > 0 && !seen[$0]++'
}

autodev_pids() {
  ps -Ao pid=,command= | awk -v root="$PROJECT_ROOT" '
    index($0, root) {
      if ($0 ~ /scripts\/dev-autodev\.sh/ || $0 ~ /src\/autodev\/worker\.ts/ || $0 ~ /dist\/autodev\/worker\.js/) {
        print $1
      }
    }
  ' | awk 'NF > 0 && !seen[$0]++'
}

graceful_stop_pids() {
  local label="$1"
  local pids="$2"
  [ -n "$pids" ] || return 0

  kill $pids 2>/dev/null || true

  local end_ts now alive pid
  end_ts=$(( $(date +%s) + SHUTDOWN_GRACE_SECONDS ))
  while true; do
    now=$(date +%s)
    [ "$now" -ge "$end_ts" ] && break
    alive=""
    for pid in $pids; do
      if kill -0 "$pid" 2>/dev/null; then
        alive="$alive $pid"
      fi
    done
    if [ -z "$alive" ]; then
      return 0
    fi
    sleep 1
  done

  log "$label did not stop in ${SHUTDOWN_GRACE_SECONDS}s, forcing kill -9"
  kill -9 $pids 2>/dev/null || true
}

watchdog_autorestart_enabled() {
  # Default mode is enabled when no flag file exists.
  [ -f "$AUTORESTART_FILE" ] || return 0

  local raw
  raw="$(tr -d '[:space:]' < "$AUTORESTART_FILE" 2>/dev/null | tr '[:upper:]' '[:lower:]')"
  case "$raw" in
    ""|"1"|"true"|"yes"|"on"|"enabled")
      return 0
      ;;
    "0"|"false"|"no"|"off"|"disabled")
      return 1
      ;;
  esac

  # Unknown content defaults to enabled for safety.
  return 0
}

in_initial_restart_grace() {
  local now
  now="$(date +%s)"
  [ $(( now - watchdog_started_at )) -lt "$INITIAL_RESTART_GRACE" ]
}

in_dependent_restart_grace() {
  [ "$gw_last_recovered" -eq 0 ] && return 1
  local now
  now="$(date +%s)"
  [ $(( now - gw_last_recovered )) -lt "$DEPENDENT_RESTART_GRACE" ]
}

# ── Backoff helpers ─────────────────────────────────────────
# should_restart <last_restart> <backoff> → return 0 if OK to restart
should_restart() {
  local last="$1" backoff="$2"
  if [ "$backoff" -eq 0 ]; then
    return 0
  fi
  local now
  now=$(date +%s)
  if [ $(( now - last )) -ge "$backoff" ]; then
    return 0
  fi
  return 1
}

# bump_backoff <current_backoff> → prints new backoff
bump_backoff() {
  local current="$1"
  if [ "$current" -eq 0 ]; then
    echo "$BACKOFF_INITIAL"
  else
    local next=$(( current * 2 ))
    [ "$next" -gt "$BACKOFF_CAP" ] && next=$BACKOFF_CAP
    echo "$next"
  fi
}

# ── Restart functions ───────────────────────────────────────
restart_gateway() {
  log "Restarting gateway..."
  if [ -z "$PNPM_BIN" ]; then
    log "Cannot restart gateway: pnpm not found (set WATCHDOG_PNPM_BIN or install pnpm)"
    return
  fi
  if ! "$SCRIPTS_DIR/build-joigateway.sh" >> "$LOG_FILE" 2>&1; then
    log "Cannot restart gateway: JOIGateway build/sign step failed"
    return
  fi
  load_project_env
  local pids
  pids="$(gateway_pids)"
  graceful_stop_pids "Gateway process" "$pids"
  if command -v lsof >/dev/null 2>&1; then
    local port_pids
    port_pids="$(lsof -ti:3100 2>/dev/null | awk 'NF > 0 && !seen[$0]++')"
    graceful_stop_pids "Port 3100 owner" "$port_pids"
  fi
  sleep 1
  cd "$PROJECT_ROOT"
  nohup "$PNPM_BIN" --filter gateway "$GATEWAY_START_SCRIPT" >> /tmp/joi-gateway.log 2>&1 &
  disown
  gw_backoff=$(bump_backoff "$gw_backoff")
  gw_last_restart=$(date +%s)
  log "Gateway restart issued (backoff: ${gw_backoff}s, failures: ${gw_failures})"
}

restart_web() {
  log "Restarting web..."
  if [ -z "$PNPM_BIN" ]; then
    log "Cannot restart web: pnpm not found (set WATCHDOG_PNPM_BIN or install pnpm)"
    return
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti:5173 | xargs kill -9 2>/dev/null || true
  fi
  sleep 1
  cd "$PROJECT_ROOT"
  nohup "$PNPM_BIN" --filter web dev >> /tmp/joi-web.log 2>&1 &
  disown
  web_backoff=$(bump_backoff "$web_backoff")
  web_last_restart=$(date +%s)
  log "Web restart issued (backoff: ${web_backoff}s, failures: ${web_failures})"
}

restart_autodev() {
  log "Restarting autodev..."
  if [ -z "$PNPM_BIN" ]; then
    log "Cannot restart autodev: pnpm not found (set WATCHDOG_PNPM_BIN or install pnpm)"
    return
  fi
  load_project_env
  local pids
  pids="$(autodev_pids)"
  graceful_stop_pids "AutoDev process" "$pids"
  sleep 1
  cd "$PROJECT_ROOT"
  nohup "$PNPM_BIN" --filter gateway dev:autodev:run >> /tmp/joi-autodev.log 2>&1 &
  disown
  ad_backoff=$(bump_backoff "$ad_backoff")
  ad_last_restart=$(date +%s)
  log "AutoDev restart issued (backoff: ${ad_backoff}s, failures: ${ad_failures})"
}

restart_livekit() {
  if [ "$livekit_local_worker_enabled" -ne 1 ]; then
    log "Skipping local livekit restart on this host (managed externally)"
    return
  fi

  log "Restarting livekit..."
  # Kill all existing agent processes (parent + children may be stuck)
  local pids
  pids=$(pgrep -f "agent.py dev" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    graceful_stop_pids "LiveKit agent" "$pids"
  fi
  cd "$PROJECT_ROOT"
  nohup "$SCRIPTS_DIR/dev-worker.sh" >> /tmp/joi-livekit-agent.log 2>&1 &
  disown
  lk_backoff=$(bump_backoff "$lk_backoff")
  lk_last_restart=$(date +%s)
  log "LiveKit restart issued (backoff: ${lk_backoff}s, failures: ${lk_failures})"
}

# ── Status JSON (atomic write) ──────────────────────────────
write_status() {
  local tmp="${STATUS_FILE}.tmp"
  local ts
  ts="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

  cat > "$tmp" <<EOF
{
  "timestamp": "$ts",
  "watchdogPid": $$,
  "autoRestartEnabled": $5,
  "services": {
    "gateway":  { "status": "$1", "failures": $gw_failures, "backoff": $gw_backoff },
    "web":      { "status": "$2", "failures": $web_failures, "backoff": $web_backoff },
    "autodev":  { "status": "$3", "failures": $ad_failures, "backoff": $ad_backoff },
    "livekit":  { "status": "$4", "failures": $lk_failures, "backoff": $lk_backoff }
  }
}
EOF
  mv "$tmp" "$STATUS_FILE"
}

# ── Main loop ───────────────────────────────────────────────
log "Watchdog started (PID $$, checking every ${CHECK_INTERVAL}s)"
if [ -n "$PNPM_BIN" ]; then
  log "Using pnpm binary: $PNPM_BIN"
else
  log "pnpm binary not found; restart actions for gateway/web/autodev will be skipped"
fi
if [ "$livekit_local_worker_enabled" -eq 1 ]; then
  log "LiveKit worker mode: local"
else
  log "LiveKit worker mode: external"
fi

while true; do
  gw_status="down"
  web_status="down"
  ad_status="down"
  lk_status="down"
  autorestart_enabled=1
  autorestart_json="true"
  initial_grace_active=0
  dependent_grace_active=0

  if watchdog_autorestart_enabled; then
    autorestart_enabled=1
    autorestart_json="true"
  else
    autorestart_enabled=0
    autorestart_json="false"
  fi

  if [ "$autorestart_json" != "$last_autorestart_state" ]; then
    if [ "$autorestart_enabled" -eq 1 ]; then
      log "Auto-restart mode: enabled"
    else
      log "Auto-restart mode: paused (via $AUTORESTART_FILE)"
    fi
    last_autorestart_state="$autorestart_json"
  fi

  if in_initial_restart_grace; then
    initial_grace_active=1
    if [ "$last_initial_grace_state" != "active" ]; then
      log "Initial restart grace active for ${INITIAL_RESTART_GRACE}s after watchdog start"
      last_initial_grace_state="active"
    fi
  else
    initial_grace_active=0
    if [ "$last_initial_grace_state" != "inactive" ]; then
      log "Initial restart grace complete; restart actions armed"
      last_initial_grace_state="inactive"
    fi
  fi

  # 1. Check gateway first (others depend on it)
  if check_gateway; then
    gw_status="healthy"
    if [ "$gw_failures" -gt 0 ]; then
      log "gateway recovered after ${gw_failures} failure(s)"
      gw_failures=0; gw_backoff=0
      gw_last_recovered="$(date +%s)"
      if [ "$ad_failures" -gt 0 ] || [ "$lk_failures" -gt 0 ]; then
        log "Resetting dependent failure counters after gateway recovery"
        ad_failures=0; ad_backoff=0
        lk_failures=0; lk_backoff=0
      fi
    fi
  else
    if [ "$initial_grace_active" -eq 0 ]; then
      gw_failures=$(( gw_failures + 1 ))
      gw_restart_threshold="$RESTART_AFTER_FAILURES"
      if [ -n "$(gateway_pids)" ]; then
        gw_restart_threshold="$RESTART_AFTER_FAILURES_WHEN_RUNNING"
      else
        gw_restart_threshold="$RESTART_AFTER_FAILURES"
      fi
      if [ "$autorestart_enabled" -eq 1 ] && [ "$gw_failures" -ge "$gw_restart_threshold" ] && should_restart "$gw_last_restart" "$gw_backoff"; then
        restart_gateway
      fi
    fi
  fi

  if in_dependent_restart_grace; then
    dependent_grace_active=1
    if [ "$last_dependent_grace_state" != "active" ]; then
      log "Dependent restart grace active for ${DEPENDENT_RESTART_GRACE}s after gateway recovery"
      last_dependent_grace_state="active"
    fi
  else
    dependent_grace_active=0
    if [ "$gw_last_recovered" -gt 0 ] && [ "$last_dependent_grace_state" != "inactive" ]; then
      log "Dependent restart grace complete"
      last_dependent_grace_state="inactive"
    elif [ "$gw_last_recovered" -eq 0 ]; then
      last_dependent_grace_state=""
    fi
  fi

  # 2. Check web (independent from gateway)
  if check_web; then
    web_status="healthy"
    if [ "$web_failures" -gt 0 ]; then
      log "web recovered after ${web_failures} failure(s)"
      web_failures=0; web_backoff=0
    fi
  else
    if [ "$initial_grace_active" -eq 0 ]; then
      web_failures=$(( web_failures + 1 ))
      if [ "$autorestart_enabled" -eq 1 ] && [ "$web_failures" -ge "$RESTART_AFTER_FAILURES" ] && should_restart "$web_last_restart" "$web_backoff"; then
        restart_web
      fi
    fi
  fi

  # 3. Check autodev (only restart if gateway is healthy)
  if check_autodev; then
    ad_status="healthy"
    if [ "$ad_failures" -gt 0 ]; then
      log "autodev recovered after ${ad_failures} failure(s)"
      ad_failures=0; ad_backoff=0
    fi
  else
    if [ "$initial_grace_active" -eq 0 ] && [ "$gw_status" = "healthy" ] && [ "$dependent_grace_active" -eq 0 ]; then
      ad_failures=$(( ad_failures + 1 ))
      if [ "$autorestart_enabled" -eq 1 ] && [ "$ad_failures" -ge "$DEPENDENT_RESTART_AFTER_FAILURES" ] && should_restart "$ad_last_restart" "$ad_backoff"; then
        restart_autodev
      fi
    fi
  fi

  # 4. Check livekit (only restart if gateway is healthy)
  if check_livekit; then
    lk_status="healthy"
    if [ "$lk_failures" -gt 0 ]; then
      log "livekit recovered after ${lk_failures} failure(s)"
      lk_failures=0; lk_backoff=0
    fi
  else
    if [ "$initial_grace_active" -eq 0 ] && [ "$gw_status" = "healthy" ] && [ "$dependent_grace_active" -eq 0 ]; then
      lk_failures=$(( lk_failures + 1 ))
      if [ "$autorestart_enabled" -eq 1 ] && [ "$lk_failures" -ge "$DEPENDENT_RESTART_AFTER_FAILURES" ] && should_restart "$lk_last_restart" "$lk_backoff"; then
        restart_livekit
      fi
    fi
  fi

  write_status "$gw_status" "$web_status" "$ad_status" "$lk_status" "$autorestart_json"
  rotate_log

  sleep "$CHECK_INTERVAL"
done
