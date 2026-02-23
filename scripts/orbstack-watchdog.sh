#!/usr/bin/env bash
# OrbStack Docker watchdog — runs on mini to detect and restart frozen OrbStack VM.
#
# Problem: OrbStack 2.0.x on macOS Tahoe periodically freezes the Docker VM.
# TCP ports stay open (kernel-level) but containers stop responding.
# The Docker daemon can appear healthy while containers are frozen inside the VM.
#
# Solution: Every 60s, test if key containers actually respond (not just the daemon).
# If they don't, restart OrbStack.
#
# Install on mini via crontab:
#   * * * * * /Users/mm2/dev_mm/joi/scripts/orbstack-watchdog.sh
set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.orbstack/bin:$PATH"

LOG_FILE="/tmp/orbstack-watchdog.log"
STATUS_FILE="/tmp/orbstack-watchdog.json"
TIMEOUT=10

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

write_status() {
  cat > "$STATUS_FILE" <<EOF
{"timestamp":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')","status":"$1","detail":"$2","pid":$$}
EOF
}

trim_log() {
  local lines
  lines=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)
  if [ "$lines" -gt 5000 ]; then
    tail -n 2500 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
  fi
}

# Check if a container actually responds, not just the daemon.
# docker exec with pg_isready is the real test — it talks to postgres inside the VM.
check_containers() {
  perl -e '
    $SIG{ALRM} = sub { exit 1 };
    alarm '"$TIMEOUT"';
    exec "docker", "exec", "joi-postgres", "pg_isready", "-U", "joi", "-q";
  ' 2>/dev/null
}

# Fallback: check if daemon itself responds
check_daemon() {
  perl -e '
    $SIG{ALRM} = sub { exit 1 };
    alarm '"$TIMEOUT"';
    exec "docker", "info";
  ' >/dev/null 2>&1
}

restart_orbstack() {
  log "RESTART: Containers unresponsive. Restarting OrbStack..."
  write_status "restarting" "Containers frozen"

  orbctl stop 2>/dev/null
  sleep 3
  orbctl start 2>/dev/null

  # Wait for postgres to come back
  local attempts=0
  while [ $attempts -lt 12 ]; do
    sleep 5
    if check_containers; then
      log "RESTART: Recovered after $((attempts * 5 + 8))s"
      write_status "healthy" "Recovered after restart"
      return 0
    fi
    attempts=$((attempts + 1))
  done

  log "RESTART: Failed to recover after 60s"
  write_status "error" "Failed to recover"
  return 1
}

# --- Main: single check (called by cron every minute) ---

# First check if containers respond
if check_containers; then
  write_status "healthy" "Postgres responsive"
  trim_log
  exit 0
fi

log "CHECK: Postgres unresponsive (timeout ${TIMEOUT}s)"

# Double-check before restarting (could be transient)
sleep 5
if check_containers; then
  log "CHECK: Recovered on retry"
  write_status "healthy" "Recovered on retry"
  trim_log
  exit 0
fi

# If daemon is also dead, definitely restart
if ! check_daemon; then
  log "CHECK: Docker daemon also unresponsive"
fi

restart_orbstack
trim_log
