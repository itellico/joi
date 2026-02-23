#!/usr/bin/env bash
# OrbStack Docker watchdog — runs on mini to detect and restart frozen OrbStack VM.
#
# Problem: OrbStack 2.0.x on macOS Tahoe periodically freezes the Docker VM.
# TCP ports stay open (kernel-level) but containers stop responding.
#
# Solution: Every 60s, test if Docker daemon responds within 10s.
# If it doesn't, restart OrbStack. This keeps DB/Redis/LiveKit alive
# without manual intervention.
#
# Install: Copy to mini, then add to crontab:
#   * * * * * /Users/mm2/dev_mm/joi/scripts/orbstack-watchdog.sh
#
# Or run as a persistent daemon:
#   nohup /Users/mm2/dev_mm/joi/scripts/orbstack-watchdog.sh --daemon &
set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.orbstack/bin:$PATH"

LOCK_FILE="/tmp/orbstack-watchdog.lock"
LOG_FILE="/tmp/orbstack-watchdog.log"
STATUS_FILE="/tmp/orbstack-watchdog.json"
CHECK_INTERVAL=60
DOCKER_TIMEOUT=10
MAX_LOG_LINES=5000

log() {
  local ts
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "[$ts] $*" >> "$LOG_FILE"
}

trim_log() {
  local lines
  lines=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)
  if [ "$lines" -gt "$MAX_LOG_LINES" ]; then
    tail -n 2500 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
  fi
}

write_status() {
  local status="$1"
  local detail="$2"
  cat > "$STATUS_FILE" <<STATUSEOF
{"timestamp":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')","status":"$status","detail":"$detail","pid":$$}
STATUSEOF
}

check_docker() {
  # Use a simple docker command with a timeout.
  # 'docker info' talks to the daemon; if it hangs, the VM is frozen.
  local result
  result=$(perl -e '
    $SIG{ALRM} = sub { exit 1 };
    alarm '"$DOCKER_TIMEOUT"';
    exec "docker", "info";
  ' 2>&1)
  return $?
}

restart_orbstack() {
  log "RESTART: OrbStack Docker daemon unresponsive. Restarting..."
  write_status "restarting" "Docker daemon unresponsive"

  orbctl stop 2>/dev/null
  sleep 3
  orbctl start 2>/dev/null

  # Wait for Docker to come back
  local attempts=0
  while [ $attempts -lt 12 ]; do
    sleep 5
    if check_docker; then
      log "RESTART: OrbStack recovered after $((attempts * 5 + 8))s"
      write_status "healthy" "Recovered after restart"
      return 0
    fi
    attempts=$((attempts + 1))
  done

  log "RESTART: OrbStack failed to recover after 60s"
  write_status "error" "Failed to recover after restart"
  return 1
}

# --- Crontab mode (default): single check, then exit ---
run_once() {
  if check_docker; then
    write_status "healthy" "Docker responsive"
    return 0
  fi

  log "CHECK: Docker unresponsive (timeout ${DOCKER_TIMEOUT}s)"

  # Double-check before restarting
  sleep 5
  if check_docker; then
    log "CHECK: Docker recovered on retry"
    write_status "healthy" "Recovered on retry"
    return 0
  fi

  restart_orbstack
}

# --- Daemon mode: persistent loop ---
run_daemon() {
  # Single-instance lock
  if ! mkdir "$LOCK_FILE" 2>/dev/null; then
    local lock_pid
    lock_pid=$(cat "$LOCK_FILE/pid" 2>/dev/null || echo "")
    if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
      echo "Already running (PID $lock_pid)"
      exit 0
    fi
    rm -rf "$LOCK_FILE"
    mkdir "$LOCK_FILE"
  fi
  echo $$ > "$LOCK_FILE/pid"

  cleanup() {
    rm -rf "$LOCK_FILE"
    exit 0
  }
  trap cleanup EXIT INT TERM

  log "DAEMON: Started (PID $$, interval ${CHECK_INTERVAL}s)"
  write_status "starting" "Daemon starting"

  while true; do
    if check_docker; then
      write_status "healthy" "Docker responsive"
    else
      log "CHECK: Docker unresponsive (timeout ${DOCKER_TIMEOUT}s)"
      sleep 5
      if ! check_docker; then
        restart_orbstack
      fi
    fi
    trim_log
    sleep "$CHECK_INTERVAL"
  done
}

# --- Entry ---
if [ "${1:-}" = "--daemon" ]; then
  run_daemon
else
  run_once
fi
