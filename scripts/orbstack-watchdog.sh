#!/usr/bin/env bash
# OrbStack container watchdog — runs on mini via launchd every 60s.
#
# Problem: OrbStack 2.0.x on macOS Tahoe freezes containers every ~15 min.
# TCP ports stay open (kernel) but postgres hangs at protocol level.
# 'docker info' and 'docker exec' can also hang when VM is frozen.
#
# Solution: Test postgres directly over TCP with a protocol-level handshake.
# No Docker CLI involved — avoids hanging on a frozen daemon.
# If postgres doesn't respond within 8s, restart OrbStack.
set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.orbstack/bin:$PATH"

LOG_FILE="/tmp/orbstack-watchdog.log"
STATUS_FILE="/tmp/orbstack-watchdog.json"
PG_HOST="127.0.0.1"
PG_PORT="5434"
TIMEOUT_SEC=8

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

# Test postgres at the TCP protocol level — send a startup packet and
# check if postgres responds. This doesn't go through Docker at all.
check_postgres() {
  python3 -c "
import socket, struct, sys
try:
    s = socket.create_connection(('$PG_HOST', $PG_PORT), timeout=$TIMEOUT_SEC)
    # Send startup message: length(8) + protocol version 3.0
    s.sendall(struct.pack('!II', 8, 196608))
    s.settimeout($TIMEOUT_SEC)
    data = s.recv(1)
    s.close()
    sys.exit(0 if data else 1)
except Exception:
    sys.exit(1)
" 2>/dev/null
}

restart_orbstack() {
  log "RESTART: Postgres unresponsive on $PG_HOST:$PG_PORT. Restarting OrbStack..."
  write_status "restarting" "Postgres frozen"

  orbctl stop 2>/dev/null
  sleep 3
  orbctl start 2>/dev/null

  local attempts=0
  while [ $attempts -lt 12 ]; do
    sleep 5
    if check_postgres; then
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

# --- Main ---
if check_postgres; then
  write_status "healthy" "Postgres responsive"
  trim_log
  exit 0
fi

log "CHECK: Postgres unresponsive (timeout ${TIMEOUT_SEC}s)"

# Double-check
sleep 3
if check_postgres; then
  log "CHECK: Recovered on retry"
  write_status "healthy" "Recovered on retry"
  trim_log
  exit 0
fi

restart_orbstack
trim_log
