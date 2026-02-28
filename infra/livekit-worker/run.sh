#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

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

resolve_python_bin() {
  local candidate=""
  for candidate in \
    "${JOI_PYTHON_BIN:-}" \
    /opt/homebrew/bin/python3.12 \
    /opt/homebrew/bin/python3.11 \
    /opt/homebrew/bin/python3 \
    /usr/local/bin/python3 \
    /usr/bin/python3 \
    python3
  do
    [ -n "$candidate" ] || continue
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

python_version_tuple() {
  local bin="$1"
  "$bin" - <<'PY'
import sys
print(f"{sys.version_info.major}.{sys.version_info.minor}")
PY
}

is_python_compatible() {
  local bin="$1"
  local version major minor
  version="$(python_version_tuple "$bin" 2>/dev/null || echo "0.0")"
  major="${version%%.*}"
  minor="${version##*.}"
  [ "$major" -gt 3 ] || { [ "$major" -eq 3 ] && [ "$minor" -ge 10 ]; }
}

PYTHON_BIN="$(resolve_python_bin || true)"
if [ -z "$PYTHON_BIN" ]; then
  echo "❌ No usable python3 interpreter found."
  exit 1
fi

if ! is_python_compatible "$PYTHON_BIN"; then
  echo "❌ Python 3.10+ required, found $(python_version_tuple "$PYTHON_BIN")."
  exit 1
fi

# Create venv if needed
if [ ! -d .venv ]; then
  echo "Creating Python virtual environment with $PYTHON_BIN..."
  "$PYTHON_BIN" -m venv .venv
elif [ ! -x .venv/bin/python ] || ! is_python_compatible .venv/bin/python; then
  echo "Recreating Python virtual environment with $PYTHON_BIN..."
  rm -rf .venv
  "$PYTHON_BIN" -m venv .venv
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

SCRIPTS_DIR="../../scripts"
if [ -x "$SCRIPTS_DIR/mini-runtime-env.sh" ]; then
  eval "$("$SCRIPTS_DIR/mini-runtime-env.sh")"
fi

echo "Starting JOI voice agent worker..."
python agent.py dev
