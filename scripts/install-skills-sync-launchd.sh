#!/usr/bin/env bash
# Install JOI skills sync as a macOS launchd agent.
#
# Usage:
#   ./scripts/install-skills-sync-launchd.sh
#   ./scripts/install-skills-sync-launchd.sh --hosts local,studio,air,mini --interval 600

set -euo pipefail

LABEL="org.joi.skills-sync"
UID_NUM="$(id -u)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SCRIPT_PATH="$PROJECT_ROOT/scripts/skills-sync.sh"
AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$AGENTS_DIR/${LABEL}.plist"

HOSTS="local"
INTERVAL="600"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --hosts <csv>      Target hosts (default: local)
  --interval <sec>   StartInterval seconds (default: 600)
  -h, --help         Show help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --hosts)
      [ "$#" -ge 2 ] || { echo "Missing value for --hosts"; exit 1; }
      HOSTS="$2"
      shift 2
      ;;
    --interval)
      [ "$#" -ge 2 ] || { echo "Missing value for --interval"; exit 1; }
      INTERVAL="$2"
      shift 2
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

if ! [[ "$INTERVAL" =~ ^[0-9]+$ ]] || [ "$INTERVAL" -lt 60 ]; then
  echo "--interval must be an integer >= 60"
  exit 1
fi

if [ ! -x "$SCRIPT_PATH" ]; then
  echo "Skills sync script not found or not executable: $SCRIPT_PATH"
  exit 1
fi

mkdir -p "$AGENTS_DIR"

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$SCRIPT_PATH</string>
    <string>--hosts</string>
    <string>$HOSTS</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$PROJECT_ROOT</string>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>$INTERVAL</integer>
  <key>StandardOutPath</key>
  <string>/tmp/joi-skills-sync.launchd.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/joi-skills-sync.launchd.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
EOF

launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$PLIST_PATH"
launchctl enable "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl kickstart -k "gui/$UID_NUM/$LABEL"

echo "Installed launchd job: $LABEL"
echo "Plist: $PLIST_PATH"
echo "Hosts: $HOSTS"
echo "Interval: ${INTERVAL}s"
if command -v rg >/dev/null 2>&1; then
  launchctl print "gui/$UID_NUM/$LABEL" | rg -n "pid =|state =|last exit code =|program =" || true
else
  launchctl print "gui/$UID_NUM/$LABEL" | grep -En "pid =|state =|last exit code =|program =" || true
fi
