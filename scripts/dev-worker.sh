#!/usr/bin/env bash
# Start LiveKit voice worker after LiveKit server + gateway are ready.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPTS_DIR")"

# Load .env to get LIVEKIT_URL
set -a
[ -f "$PROJECT_ROOT/.env" ] && source "$PROJECT_ROOT/.env"
set +a

# Resolve mini alias to active Home/Road IP for this process without requiring /etc/hosts edits.
if [ -x "$SCRIPTS_DIR/mini-runtime-env.sh" ]; then
  eval "$("$SCRIPTS_DIR/mini-runtime-env.sh")"
fi

# Parse LiveKit host/port from LIVEKIT_URL (ws://host:port)
LK_HOST=$(echo "$LIVEKIT_URL" | sed -E 's|wss?://([^:]+):([0-9]+).*|\1|')
LK_PORT=$(echo "$LIVEKIT_URL" | sed -E 's|wss?://([^:]+):([0-9]+).*|\2|')

"$SCRIPTS_DIR/wait-for.sh" "$LK_HOST" "$LK_PORT" "LiveKit" 120
"$SCRIPTS_DIR/wait-for.sh" "127.0.0.1" "3100" "Gateway" 120

echo "🚀 Starting LiveKit voice worker..."
cd "$PROJECT_ROOT/infra/livekit-worker"
exec ./run.sh
