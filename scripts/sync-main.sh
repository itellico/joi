#!/usr/bin/env bash
# Safe sync helper for JOI main branch across local -> origin -> remote machines.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

HOSTS_CSV="studio,mini"
COMMIT_MESSAGE=""
DRY_RUN="false"
PULL_MODE="ff-only"
declare -a FILES=()

usage() {
  cat <<'EOF'
Usage:
  ./scripts/sync-main.sh [options]

Options:
  --message "msg"            Commit message for a targeted commit.
  --file path                File to include in targeted commit (repeatable).
  --hosts studio,mini        Remote hosts to pull after push. Default: studio,mini
  --pull-mode ff-only|rebase Pull mode on remote hosts. Default: ff-only
  --dry-run                  Print actions without executing.
  -h, --help                 Show help.

Behavior:
  1) Optionally creates a targeted commit (only files passed via --file).
  2) Rebase-pulls local main from origin/main.
  3) Pushes local main to origin.
  4) Pulls latest main on each remote host.
EOF
}

log() {
  printf '[sync-main] %s\n' "$*"
}

run_cmd() {
  if [ "$DRY_RUN" = "true" ]; then
    log "DRY: $*"
    return 0
  fi
  "$@"
}

run_ssh() {
  local host="$1"
  shift
  local cmd="$*"
  if [ "$DRY_RUN" = "true" ]; then
    log "DRY: ssh $host \"$cmd\""
    return 0
  fi
  ssh "$host" "$cmd"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --message)
      COMMIT_MESSAGE="${2:-}"
      shift 2
      ;;
    --file)
      FILES+=("${2:-}")
      shift 2
      ;;
    --hosts)
      HOSTS_CSV="${2:-}"
      shift 2
      ;;
    --pull-mode)
      PULL_MODE="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [ "$PULL_MODE" != "ff-only" ] && [ "$PULL_MODE" != "rebase" ]; then
  echo "Invalid --pull-mode: $PULL_MODE" >&2
  exit 1
fi

cd "$PROJECT_ROOT"

branch="$(git branch --show-current)"
if [ "$branch" != "main" ]; then
  echo "sync-main.sh must run on main branch (current: $branch)" >&2
  exit 1
fi

upstream="$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || true)"
if [ "$upstream" != "origin/main" ]; then
  echo "Expected upstream origin/main (current: ${upstream:-none})" >&2
  exit 1
fi

if [ -n "$COMMIT_MESSAGE" ]; then
  if [ "${#FILES[@]}" -eq 0 ]; then
    echo "--message requires at least one --file" >&2
    exit 1
  fi
  log "Creating targeted commit"
  run_cmd git add "${FILES[@]}"
  staged_count="$(git diff --cached --name-only | wc -l | tr -d ' ')"
  if [ "$staged_count" -eq 0 ]; then
    log "No staged changes for requested files, skipping commit."
  else
    run_cmd git commit -m "$COMMIT_MESSAGE"
  fi
fi

log "Pulling latest origin/main with rebase/autostash"
run_cmd git pull --rebase --autostash origin main

log "Pushing main to origin"
run_cmd git push origin main

IFS=',' read -r -a HOSTS <<<"$HOSTS_CSV"
for host in "${HOSTS[@]}"; do
  host="$(printf '%s' "$host" | tr -d '[:space:]')"
  [ -n "$host" ] || continue
  log "Syncing host: $host"
  if [ "$PULL_MODE" = "rebase" ]; then
    run_ssh "$host" "cd /Users/mm2/dev_mm/joi && git pull --rebase --autostash origin main"
  else
    run_ssh "$host" "cd /Users/mm2/dev_mm/joi && git pull --ff-only origin main"
  fi
done

log "Done."
