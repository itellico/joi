#!/usr/bin/env bash
# Install the OrbStack watchdog as a launchd agent on the current Mac.
# This is more reliable than cron on macOS (cron needs Full Disk Access).
set -euo pipefail

LABEL="org.joi.orbstack-watchdog"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$SCRIPT_DIR/orbstack-watchdog.sh"

if [ ! -x "$SCRIPT" ]; then
  echo "Error: $SCRIPT not found or not executable"
  exit 1
fi

# Remove old version if loaded
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true

cat > "$PLIST_PATH" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${SCRIPT}</string>
  </array>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/orbstack-watchdog.launchd.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/orbstack-watchdog.launchd.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
PLISTEOF

launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl enable "gui/$(id -u)/$LABEL"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

echo "Installed and started: $LABEL"
echo "Plist: $PLIST_PATH"
echo "Runs every 60s, logs to /tmp/orbstack-watchdog.launchd.log"
echo ""
echo "To check status:  launchctl print gui/$(id -u)/$LABEL"
echo "To uninstall:     launchctl bootout gui/$(id -u)/$LABEL && rm $PLIST_PATH"
