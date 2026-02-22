#!/usr/bin/env bash
set -euo pipefail

WORKDIR="$(cd "$(dirname "$0")" && pwd)"
cd "$WORKDIR"

kill_stale_workers() {
  local pid=""
  local cwd=""
  local stale_pids=""
  local alive_pids=""

  while IFS= read -r pid; do
    [ -z "$pid" ] && continue
    [ "$pid" -eq "$$" ] && continue
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n1 || true)"
    if [ "$cwd" = "$WORKDIR" ]; then
      stale_pids="$stale_pids $pid"
    fi
  done < <(pgrep -f "agent.py dev" || true)

  if [ -z "${stale_pids// /}" ]; then
    return
  fi

  echo "Stopping stale JOI LiveKit worker process(es):$stale_pids"
  kill $stale_pids 2>/dev/null || true

  local deadline=$((SECONDS + 5))
  while [ "$SECONDS" -lt "$deadline" ]; do
    alive_pids=""
    for pid in $stale_pids; do
      if kill -0 "$pid" 2>/dev/null; then
        alive_pids="$alive_pids $pid"
      fi
    done
    [ -z "${alive_pids// /}" ] && break
    sleep 0.2
  done

  if [ -n "${alive_pids// /}" ]; then
    echo "Force-killing stuck worker process(es):$alive_pids"
    kill -9 $alive_pids 2>/dev/null || true
  fi
}

kill_stale_workers

# Create venv if needed
if [ ! -d .venv ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv .venv
fi

source .venv/bin/activate

# Install/upgrade deps
pip install -q -r requirements.txt

# Source project .env for LIVEKIT_URL, API keys, etc.
ENV_FILE="../../.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

echo "Starting JOI voice agent worker..."
python agent.py dev
