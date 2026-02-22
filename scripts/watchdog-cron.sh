#!/usr/bin/env bash
# Safety net: ensures watchdog.sh is running. Add to crontab:
#   * * * * * /Users/mm2/dev_mm/joi/scripts/watchdog-cron.sh
set -uo pipefail

PID_FILE="/tmp/joi-watchdog.pid"
LOCK_DIR="/tmp/joi-watchdog.lock"
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

if pgrep -f "scripts/watchdog.sh" >/dev/null 2>&1; then
  exit 0
fi

if [ -d "$LOCK_DIR" ]; then
  lock_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
    cmd="$(ps -p "$lock_pid" -o command= 2>/dev/null || true)"
    case "$cmd" in
      *watchdog.sh*) exit 0 ;;
    esac
  fi
  rm -rf "$LOCK_DIR" 2>/dev/null || true
  rm -f "$PID_FILE" 2>/dev/null || true
fi

nohup "$SCRIPTS_DIR/watchdog.sh" >> /tmp/joi-watchdog.log 2>&1 &
