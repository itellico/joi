#!/usr/bin/env bash
# wait-for.sh — wait for a TCP service to become available
# Usage: ./scripts/wait-for.sh <host> <port> <label> [timeout_seconds]

set -euo pipefail

HOST="$1"
PORT="$2"
LABEL="${3:-$HOST:$PORT}"
TIMEOUT="${4:-60}"

elapsed=0
interval=2

while ! nc -z "$HOST" "$PORT" 2>/dev/null; do
  if [ "$elapsed" -ge "$TIMEOUT" ]; then
    echo "✗ Timed out waiting for $LABEL ($HOST:$PORT) after ${TIMEOUT}s"
    exit 1
  fi
  if [ "$elapsed" -eq 0 ]; then
    echo "⏳ Waiting for $LABEL ($HOST:$PORT)..."
  fi
  sleep "$interval"
  elapsed=$((elapsed + interval))
done

echo "✓ $LABEL is ready ($HOST:$PORT)"
