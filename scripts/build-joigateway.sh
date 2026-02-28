#!/usr/bin/env bash
# Build and sign JOIGateway.app with a stable identity for macOS TCC.
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPTS_DIR")"

APP_PATH="$PROJECT_ROOT/JOIGateway.app"
CONTENTS_DIR="$APP_PATH/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
BIN_PATH="$MACOS_DIR/JOIGateway"
SRC_PATH="$BIN_PATH.c"
PLIST_PATH="$CONTENTS_DIR/Info.plist"

BUNDLE_ID="com.joi.gateway"
BUNDLE_NAME="JOI Gateway"
APP_VERSION="1.0"

log() {
  printf "[build-joigateway] %s\n" "$*"
}

is_true() {
  case "$(printf "%s" "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')" in
    1|true|yes|on|enabled) return 0 ;;
    *) return 1 ;;
  esac
}

ensure_bundle_layout() {
  mkdir -p "$MACOS_DIR"

  if [ ! -f "$PLIST_PATH" ]; then
    cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${BUNDLE_ID}</string>
  <key>CFBundleName</key>
  <string>${BUNDLE_NAME}</string>
  <key>CFBundleExecutable</key>
  <string>JOIGateway</string>
  <key>CFBundleVersion</key>
  <string>${APP_VERSION}</string>
  <key>LSUIElement</key>
  <true/>
  <key>LSBackgroundOnly</key>
  <true/>
</dict>
</plist>
EOF
  fi

  if /usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$PLIST_PATH" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE_ID" "$PLIST_PATH" >/dev/null
  else
    /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string $BUNDLE_ID" "$PLIST_PATH" >/dev/null
  fi
}

build_binary_if_needed() {
  if [ ! -f "$SRC_PATH" ]; then
    log "Missing source file: $SRC_PATH"
    exit 1
  fi

  if [ ! -x "$BIN_PATH" ] || [ "$SRC_PATH" -nt "$BIN_PATH" ]; then
    log "Compiling JOIGateway binary..."
    cc -O2 -Wall -Wextra -o "$BIN_PATH" "$SRC_PATH" -lsqlite3
  else
    log "Binary is up to date."
  fi
}

resolve_codesign_identity() {
  if [ -n "${JOI_GATEWAY_CODESIGN_IDENTITY:-}" ]; then
    printf "%s\n" "$JOI_GATEWAY_CODESIGN_IDENTITY"
    return 0
  fi

  local team_id identity
  team_id="${JOI_GATEWAY_CODESIGN_TEAM_ID:-}"
  if [ -n "$team_id" ]; then
    identity="$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' -v team="$team_id" '/Apple Development:/ && $2 ~ "\\(" team "\\)$" { print $2; exit }')"
    if [ -n "$identity" ]; then
      printf "%s\n" "$identity"
      return 0
    fi
  fi

  identity="$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Apple Development:/ { print $2; exit }')"
  if [ -n "$identity" ]; then
    printf "%s\n" "$identity"
    return 0
  fi

  if is_true "${JOI_GATEWAY_ALLOW_ADHOC:-}"; then
    printf "%s\n" "-"
    return 0
  fi

  log "No Apple Development signing identity found."
  log "Set JOI_GATEWAY_CODESIGN_IDENTITY to a valid identity from:"
  security find-identity -v -p codesigning || true
  exit 1
}

sign_bundle() {
  local identity="$1"
  # Codesign rejects bundles with Finder/resource-fork metadata.
  xattr -cr "$APP_PATH"
  log "Codesigning JOIGateway.app with: $identity"
  codesign --force --deep --sign "$identity" --identifier "$BUNDLE_ID" "$APP_PATH"
  codesign --verify --deep --strict "$APP_PATH"
}

print_signature_summary() {
  local summary
  summary="$(codesign -dv --verbose=4 "$APP_PATH" 2>&1 | grep -E 'Identifier=|TeamIdentifier=|Authority=|Signature=')"
  log "Signature summary:"
  printf "%s\n" "$summary"
}

ensure_bundle_layout
build_binary_if_needed
SIGNING_IDENTITY="$(resolve_codesign_identity)"
sign_bundle "$SIGNING_IDENTITY"
print_signature_summary
