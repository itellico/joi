#!/usr/bin/env bash
# JOI Skills Sync
# Keeps skill folders aligned across local/remote Macs without destructive git actions.
#
# Default behavior:
# - sync only local machine
# - fast-forward pull mm repo only when clean and behind
# - never auto-push, never resolve divergence automatically
# - refresh Claude skills links from ~/dev_mm/mm/claude/skills
# - refresh Gemini skills links from ~/.agents/skills
#
# Usage examples:
#   ./scripts/skills-sync.sh
#   ./scripts/skills-sync.sh --hosts local,studio,air,mini
#   ./scripts/skills-sync.sh --local-only
#   ./scripts/skills-sync.sh --hosts local,studio,air,mini --dry-run

set -euo pipefail

SELF_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
JOI_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

MM_REPO="${JOI_MM_REPO:-$HOME/dev_mm/mm}"
CLAUDE_SOURCE_DIR="${JOI_CLAUDE_SKILLS_SOURCE:-$MM_REPO/claude/skills}"
CLAUDE_TARGET_DIR="${JOI_CLAUDE_SKILLS_TARGET:-$HOME/.claude/skills}"
AGENTS_SOURCE_DIR="${JOI_AGENTS_SKILLS_SOURCE:-$HOME/.agents/skills}"
GEMINI_TARGET_DIR="${JOI_GEMINI_SKILLS_TARGET:-$HOME/.gemini/skills}"
REMOTE_SCRIPT_PATH="${JOI_REMOTE_SCRIPT_PATH:-$SELF_PATH}"
GIT_SYNC_TIMEOUT_SECONDS="${JOI_GIT_SYNC_TIMEOUT_SECONDS:-20}"
REMOTE_PUSH_SOURCES="${JOI_REMOTE_PUSH_SOURCES:-1}"
SSH_KEY_FILE="${JOI_SSH_KEY_FILE:-$HOME/.ssh/id_rsa}"
SSH_CALL_TIMEOUT_SECONDS="${JOI_SSH_CALL_TIMEOUT_SECONDS:-25}"

HOSTS="local"
LOCAL_ONLY="0"
DRY_RUN="0"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="${JOI_SKILL_SYNC_LOG:-/tmp/joi-skills-sync.log}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=8)
RSYNC_SSH="ssh -o BatchMode=yes -o ConnectTimeout=8"
TIMEOUT_BIN=""

if command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_BIN="gtimeout"
elif command -v timeout >/dev/null 2>&1; then
  TIMEOUT_BIN="timeout"
fi

if [ -f "$SSH_KEY_FILE" ]; then
  SSH_OPTS+=(-i "$SSH_KEY_FILE" -o IdentitiesOnly=yes -o IdentityAgent=none)
  RSYNC_SSH="ssh -o BatchMode=yes -o ConnectTimeout=8 -i $SSH_KEY_FILE -o IdentitiesOnly=yes -o IdentityAgent=none"
fi

log() {
  local level="$1"; shift
  local msg="$*"
  printf '[%s] [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$level" "$msg" | tee -a "$LOG_FILE"
}

run_cmd() {
  if [ "$DRY_RUN" = "1" ]; then
    log DRY "$*"
    return 0
  fi
  eval "$@"
}

run_with_timeout() {
  local timeout_s="$1"
  shift
  local cmd="$*"
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$timeout_s" "$cmd" <<'PY'
import os
import signal
import subprocess
import sys

timeout = int(float(sys.argv[1]))
cmd = sys.argv[2]

p = subprocess.Popen(
    cmd,
    shell=True,
    executable="/bin/bash",
    start_new_session=True,
)

try:
    p.wait(timeout=timeout)
    raise SystemExit(p.returncode)
except subprocess.TimeoutExpired:
    try:
        os.killpg(p.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        p.wait(timeout=3)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    raise SystemExit(124)
PY
    return $?
  fi

  perl -e 'alarm shift @ARGV; exec @ARGV' "$timeout_s" /bin/bash -lc "$cmd"
}

run_timed_ssh() {
  local host="$1"
  shift
  if [ -n "$TIMEOUT_BIN" ]; then
    "$TIMEOUT_BIN" "${SSH_CALL_TIMEOUT_SECONDS}s" ssh "${SSH_OPTS[@]}" "$host" "$@"
  else
    ssh "${SSH_OPTS[@]}" "$host" "$@"
  fi
}

run_timed_rsync() {
  if [ -n "$TIMEOUT_BIN" ]; then
    "$TIMEOUT_BIN" "${SSH_CALL_TIMEOUT_SECONDS}s" rsync -az -e "$RSYNC_SSH" "$@"
  else
    rsync -az -e "$RSYNC_SSH" "$@"
  fi
}

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --hosts <csv>      Hosts to sync (default: local)
  --local-only       Run only local sync logic
  --dry-run          Print actions without changing anything
  -h, --help         Show help

Env overrides:
  JOI_MM_REPO
  JOI_CLAUDE_SKILLS_SOURCE
  JOI_CLAUDE_SKILLS_TARGET
  JOI_AGENTS_SKILLS_SOURCE
  JOI_GEMINI_SKILLS_TARGET
  JOI_REMOTE_SCRIPT_PATH
  JOI_GIT_SYNC_TIMEOUT_SECONDS
  JOI_REMOTE_PUSH_SOURCES
  JOI_SSH_KEY_FILE
  JOI_SSH_CALL_TIMEOUT_SECONDS
  JOI_SKILL_SYNC_LOG
EOF
}

backup_if_regular_file_or_dir() {
  local target="$1"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    local parent backup_root backup_name backup
    parent="$(dirname "$target")"
    backup_root="$parent/.backups"
    backup_name="$(basename "$target").backup.${TIMESTAMP}"
    backup="$backup_root/$backup_name"
    log WARN "Backing up existing non-symlink: $target -> $backup"
    run_cmd "mkdir -p '$backup_root'"
    run_cmd "mv '$target' '$backup'"
  fi
}

ensure_symlink() {
  local source="$1"
  local target="$2"

  backup_if_regular_file_or_dir "$target"
  run_cmd "mkdir -p '$(dirname "$target")'"

  if [ -L "$target" ]; then
    local current
    current="$(readlink "$target" || true)"
    if [ "$current" = "$source" ]; then
      return 0
    fi
  fi

  run_cmd "ln -sfn '$source' '$target'"
}

sync_git_repo_ff_only() {
  local repo="$1"
  if [ ! -d "$repo/.git" ]; then
    log WARN "mm repo not found at $repo (skipping git sync)"
    return 0
  fi

  if [ "$DRY_RUN" = "1" ]; then
    log DRY "git sync check for $repo (skipping fetch/pull in dry-run)"
    return 0
  fi

  local dirty_count
  dirty_count="$(git -C "$repo" status --porcelain | wc -l | tr -d ' ')"

  local git_env_prefix="GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND='ssh -o BatchMode=yes -o ConnectTimeout=8'"

  local fetch_cmd="$git_env_prefix git -C '$repo' fetch --quiet --all --prune 2>/dev/null"
  local fetch_rc=0
  run_with_timeout "$GIT_SYNC_TIMEOUT_SECONDS" "$fetch_cmd" || fetch_rc="$?"
  if [ "$fetch_rc" -ne 0 ]; then
    if [ "$fetch_rc" -eq 142 ] || [ "$fetch_rc" -eq 124 ]; then
      log WARN "git fetch timed out for $repo after ${GIT_SYNC_TIMEOUT_SECONDS}s"
    else
      log WARN "git fetch failed for $repo (exit=$fetch_rc)"
    fi
    return 0
  fi

  local upstream=""
  if git -C "$repo" rev-parse --abbrev-ref --symbolic-full-name "@{u}" >/dev/null 2>&1; then
    upstream="$(git -C "$repo" rev-parse --abbrev-ref --symbolic-full-name "@{u}")"
  fi

  if [ -z "$upstream" ]; then
    log INFO "No upstream configured for $repo branch; skipping pull"
    return 0
  fi

  local ahead behind
  ahead="$(git -C "$repo" rev-list --count "${upstream}..HEAD" 2>/dev/null || echo 0)"
  behind="$(git -C "$repo" rev-list --count "HEAD..${upstream}" 2>/dev/null || echo 0)"

  if [ "$dirty_count" != "0" ]; then
    log WARN "Dirty working tree in $repo ($dirty_count files). Skipping pull."
    return 0
  fi

  if [ "$behind" -gt 0 ] && [ "$ahead" -eq 0 ]; then
    log INFO "Repo behind upstream by $behind commit(s). Pulling fast-forward."
    local pull_cmd="$git_env_prefix git -C '$repo' pull --ff-only --quiet 2>/dev/null"
    local pull_rc=0
    run_with_timeout "$GIT_SYNC_TIMEOUT_SECONDS" "$pull_cmd" || pull_rc="$?"
    if [ "$pull_rc" -eq 0 ]; then
      log INFO "Fast-forward pull completed for $repo"
    else
      if [ "$pull_rc" -eq 142 ] || [ "$pull_rc" -eq 124 ]; then
        log WARN "Fast-forward pull timed out for $repo after ${GIT_SYNC_TIMEOUT_SECONDS}s"
      else
        log WARN "Fast-forward pull failed for $repo (exit=$pull_rc)"
      fi
    fi
    return 0
  fi

  if [ "$ahead" -gt 0 ] && [ "$behind" -eq 0 ]; then
    log WARN "Repo is ahead by $ahead commit(s). Not auto-pushing."
    return 0
  fi

  if [ "$ahead" -gt 0 ] && [ "$behind" -gt 0 ]; then
    log WARN "Repo has diverged (ahead $ahead / behind $behind). Manual sync required."
    return 0
  fi

  log INFO "Repo already up-to-date."
}

sync_claude_skills() {
  local source_dir="$1"
  local target_dir="$2"

  if [ ! -d "$source_dir" ]; then
    log WARN "Claude skills source missing: $source_dir"
    return 0
  fi

  run_cmd "mkdir -p '$target_dir'"

  local count=0
  local linked=0
  while IFS= read -r -d '' skill_path; do
    [ -d "$skill_path" ] || continue
    local skill_name target
    skill_name="$(basename "$skill_path")"
    target="$target_dir/$skill_name"
    count=$((count + 1))

    # Keep plugin-managed mappings untouched (if linked from .agents)
    if [ -L "$target" ] && [[ "$(readlink "$target" || true)" == *".agents"* ]]; then
      continue
    fi

    ensure_symlink "$skill_path" "$target"
    linked=$((linked + 1))
  done < <(find -L "$source_dir" -mindepth 1 -maxdepth 1 -type d -print0)

  log INFO "Claude skills synced: $linked link(s) refreshed from $count source dir(s)."
}

sync_gemini_skills_from_agents() {
  local agents_dir="$1"
  local gemini_dir="$2"

  if [ ! -d "$agents_dir" ]; then
    log WARN "Agents skills source missing: $agents_dir (Gemini sync skipped)"
    return 0
  fi

  run_cmd "mkdir -p '$gemini_dir'"

  local count=0
  while IFS= read -r -d '' skill_path; do
    [ -d "$skill_path" ] || continue
    local skill_name target
    skill_name="$(basename "$skill_path")"
    target="$gemini_dir/$skill_name"

    ensure_symlink "$skill_path" "$target"
    count=$((count + 1))
  done < <(find -L "$agents_dir" -mindepth 1 -maxdepth 1 -type d -print0)

  log INFO "Gemini skills synced from agents source: $count link(s) refreshed."
}

count_skill_dirs() {
  local dir="$1"
  if [ ! -d "$dir" ]; then
    echo 0
    return
  fi
  local n=0
  while IFS= read -r -d '' entry; do
    if [ -f "$entry/SKILL.md" ]; then
      n=$((n + 1))
    fi
  done < <(find -L "$dir" -mindepth 1 -maxdepth 1 -type d -print0)
  echo "$n"
}

run_local_sync() {
  log INFO "Starting local skills sync on host: $(hostname)"
  sync_git_repo_ff_only "$MM_REPO"
  sync_claude_skills "$CLAUDE_SOURCE_DIR" "$CLAUDE_TARGET_DIR"
  sync_gemini_skills_from_agents "$AGENTS_SOURCE_DIR" "$GEMINI_TARGET_DIR"

  local claude_count gemini_count agents_count codex_system_count
  claude_count="$(count_skill_dirs "$CLAUDE_TARGET_DIR")"
  gemini_count="$(count_skill_dirs "$GEMINI_TARGET_DIR")"
  agents_count="$(count_skill_dirs "$AGENTS_SOURCE_DIR")"
  codex_system_count="$(count_skill_dirs "$HOME/.codex/skills/.system")"

  log INFO "Counts: claude=$claude_count gemini=$gemini_count agents=$agents_count codex_system=$codex_system_count"
  log INFO "Local skills sync complete"
}

sync_remote_sources() {
  local host="$1"
  if [ "$REMOTE_PUSH_SOURCES" != "1" ]; then
    return 0
  fi

  if ! command -v rsync >/dev/null 2>&1; then
    log WARN "rsync not found locally; remote source push skipped for $host"
    return 0
  fi

  local src_dirs=("$CLAUDE_SOURCE_DIR" "$AGENTS_SOURCE_DIR")
  local src
  for src in "${src_dirs[@]}"; do
    if [ ! -d "$src" ]; then
      log WARN "Local source missing for remote push: $src"
      continue
    fi

    if [ "$DRY_RUN" = "1" ]; then
      log DRY "ssh ${SSH_OPTS[*]} '$host' \"mkdir -p '$src'\""
      log DRY "rsync -az -e \"$RSYNC_SSH\" '$src/' '$host:$src/'"
      continue
    fi

    if ! run_timed_ssh "$host" "mkdir -p '$src'"; then
      log WARN "Failed to create remote source dir on $host: $src"
      continue
    fi

    if run_timed_rsync "$src/" "$host:$src/"; then
      log INFO "Remote source pushed: $host:$src"
    else
      log WARN "Remote source push failed: $host:$src"
    fi
  done
}

run_remote_sync() {
  local host="$1"
  local dry_arg=""
  local remote_script="$REMOTE_SCRIPT_PATH"
  local remote_env="JOI_GIT_SYNC_TIMEOUT_SECONDS='$GIT_SYNC_TIMEOUT_SECONDS'"
  [ "$DRY_RUN" = "1" ] && dry_arg="--dry-run"

  log INFO "Syncing remote host: $host"
  sync_remote_sources "$host"

  if run_timed_ssh "$host" "test -x '$remote_script'"; then
    if run_timed_ssh "$host" "$remote_env bash '$remote_script' --local-only $dry_arg"; then
      log INFO "Remote host synced: $host (path mode)"
      return 0
    fi
    log WARN "Remote host path-mode sync failed: $host"
    return 1
  fi

  log WARN "Remote script missing at $remote_script on $host; using stream mode"
  if [ -n "$TIMEOUT_BIN" ]; then
    if "$TIMEOUT_BIN" "${SSH_CALL_TIMEOUT_SECONDS}s" ssh "${SSH_OPTS[@]}" "$host" "$remote_env bash -s -- --local-only $dry_arg" < "$SELF_PATH"; then
      log INFO "Remote host synced: $host (stream mode)"
      return 0
    fi
  elif ssh "${SSH_OPTS[@]}" "$host" "$remote_env bash -s -- --local-only $dry_arg" < "$SELF_PATH"; then
    log INFO "Remote host synced: $host (stream mode)"
    return 0
  fi

  log WARN "Remote host stream-mode sync failed: $host"
  return 1
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --hosts)
        [ "$#" -ge 2 ] || { echo "Missing value for --hosts"; exit 1; }
        HOSTS="$2"
        shift 2
        ;;
      --local-only)
        LOCAL_ONLY="1"
        shift
        ;;
      --dry-run)
        DRY_RUN="1"
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "Unknown argument: $1"
        usage
        exit 1
        ;;
    esac
  done
}

main() {
  parse_args "$@"
  log INFO "JOI skills sync invoked (hosts=$HOSTS local_only=$LOCAL_ONLY dry_run=$DRY_RUN)"

  if [ "$LOCAL_ONLY" = "1" ]; then
    run_local_sync
    exit 0
  fi

  IFS=',' read -r -a host_arr <<< "$HOSTS"
  local failures=0
  for raw in "${host_arr[@]}"; do
    local host
    host="$(echo "$raw" | xargs)"
    [ -n "$host" ] || continue

    if [ "$host" = "local" ] || [ "$host" = "$(hostname -s)" ] || [ "$host" = "$(hostname)" ]; then
      run_local_sync || failures=$((failures + 1))
    else
      run_remote_sync "$host" || failures=$((failures + 1))
    fi
  done

  if [ "$failures" -gt 0 ]; then
    log WARN "Skills sync completed with $failures failure(s)."
    exit 1
  fi

  log INFO "Skills sync completed successfully on all targets."
}

main "$@"
