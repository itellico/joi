#!/usr/bin/env bash
# Start gateway after postgres is ready. Safe to run in any order.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPTS_DIR")"

# Keep JOIGateway.app signed with a stable identity to avoid recurring
# Full Disk Access denials for Messages/chat.db reads.
"$SCRIPTS_DIR/build-joigateway.sh"

# Load .env to get DATABASE_URL
set -a
[ -f "$PROJECT_ROOT/.env" ] && source "$PROJECT_ROOT/.env"
set +a

# Resolve mini alias to active Home/Road IP for this process without requiring /etc/hosts edits.
if [ -x "$SCRIPTS_DIR/mini-runtime-env.sh" ]; then
  eval "$("$SCRIPTS_DIR/mini-runtime-env.sh")"
fi

# Parse postgres host/port from DATABASE_URL
PG_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:]+):([0-9]+)/.*|\1|')
PG_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:]+):([0-9]+)/.*|\2|')

"$SCRIPTS_DIR/wait-for.sh" "$PG_HOST" "$PG_PORT" "PostgreSQL" 120

ensure_native_binding_compat() {
  local pkg_name="$1"
  local check_cmd="$2"
  local check_log="/tmp/joi-${pkg_name}-check.log"

  if pnpm --filter gateway exec node -e "$check_cmd" >"$check_log" 2>&1; then
    return 0
  fi

  if ! grep -qi "incompatible architecture" "$check_log"; then
    echo "⚠️  ${pkg_name} check failed (non-arch issue). Continuing without auto-rebuild."
    return 0
  fi

  echo "⚠️  ${pkg_name} architecture mismatch detected. Rebuilding native binding..."
  local pkg_dir
  pkg_dir="$(find "$PROJECT_ROOT/node_modules/.pnpm" -maxdepth 1 -type d -name "${pkg_name}@*" | head -1)"
  if [ -z "$pkg_dir" ] || [ ! -d "$pkg_dir/node_modules/$pkg_name" ]; then
    echo "⚠️  Could not locate ${pkg_name} package folder. Skipping auto-rebuild."
    return 0
  fi

  (
    cd "$pkg_dir/node_modules/$pkg_name"
    npm rebuild >"/tmp/joi-${pkg_name}-rebuild.log" 2>&1
  ) || echo "⚠️  ${pkg_name} rebuild failed. See /tmp/joi-${pkg_name}-rebuild.log"
}

ensure_native_binding_compat "better-sqlite3" "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.close();"
ensure_native_binding_compat "sqlite3" "const sqlite3=require('sqlite3'); if (!sqlite3.Database) throw new Error('sqlite3 Database missing');"

# Run migrations before starting
echo "🔄 Running database migrations..."
cd "$PROJECT_ROOT"
pnpm --filter gateway db:migrate 2>&1 || echo "⚠️  Migrations skipped (may already be up to date)"

# Kill stale gateway processes
pkill -f "tsx watch.*src/server.ts" 2>/dev/null || true
pkill -f "tsx src/server.ts" 2>/dev/null || true

GATEWAY_PORT_VALUE="${GATEWAY_PORT:-3100}"

for _ in 1 2 3 4 5; do
  if ! lsof -ti:"$GATEWAY_PORT_VALUE" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

lsof -ti:"$GATEWAY_PORT_VALUE" | xargs kill -9 2>/dev/null || true
sleep 0.5

echo "🚀 Starting gateway..."
GATEWAY_DEV_SCRIPT="${GATEWAY_DEV_SCRIPT:-dev}"
exec pnpm --filter gateway "$GATEWAY_DEV_SCRIPT"
