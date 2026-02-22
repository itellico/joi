#!/usr/bin/env bash
# Remove persistent watchdog launchd agent.
# Usage: ./scripts/uninstall-watchdog-launchd.sh
set -euo pipefail

LABEL="org.joi.watchdog"
UID_NUM="$(id -u)"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"

launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
rm -f "$PLIST_PATH"

echo "Removed launchd job: $LABEL"
echo "Deleted plist: $PLIST_PATH"
