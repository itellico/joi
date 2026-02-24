#!/usr/bin/env bash
# Uninstall JOI skills sync launchd agent.
set -euo pipefail

LABEL="org.joi.skills-sync"
UID_NUM="$(id -u)"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"

launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
rm -f "$PLIST_PATH"

echo "Removed launchd job: $LABEL"
echo "Removed plist: $PLIST_PATH"
