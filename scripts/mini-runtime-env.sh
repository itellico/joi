#!/usr/bin/env bash
set -euo pipefail

OUTPUT_FORMAT="${1:-shell}"
if [[ "$OUTPUT_FORMAT" == "--plain" ]]; then
  OUTPUT_FORMAT="plain"
fi
if [[ "$OUTPUT_FORMAT" != "shell" && "$OUTPUT_FORMAT" != "plain" ]]; then
  echo "Usage: $0 [shell|--plain]" >&2
  exit 1
fi

HOST_ALIAS="${JOI_MINI_HOST_ALIAS:-mini}"
HOST_NAME="${JOI_MINI_HOSTNAME:-marcuss-mini}"
HOME_IP="${JOI_MINI_HOME_IP:-}"
ROAD_IP="${JOI_MINI_ROAD_IP:-}"
PROBE_PORTS_RAW="${JOI_MINI_PROBE_PORTS:-5434,11434,7880,22}"
MODE_RAW="${JOI_LIVEKIT_NETWORK_MODE:-${JOI_ROAD_MODE:-auto}}"
CURRENT_HOST="$(hostname 2>/dev/null | tr '[:upper:]' '[:lower:]')"
CURRENT_HOST_SHORT="${CURRENT_HOST%%.*}"
HOST_ALIAS_NORMALIZED="$(printf "%s" "$HOST_ALIAS" | tr '[:upper:]' '[:lower:]')"
HOST_NAME_NORMALIZED="$(printf "%s" "$HOST_NAME" | tr '[:upper:]' '[:lower:]')"

normalize_mode() {
  local raw="${1:-auto}"
  raw="$(printf "%s" "$raw" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  case "$raw" in
    home|road) printf "%s" "$raw" ;;
    *) printf "auto" ;;
  esac
}

is_ipv4() {
  local value="${1:-}"
  [[ "$value" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  IFS='.' read -r a b c d <<<"$value"
  for part in "$a" "$b" "$c" "$d"; do
    ((part >= 0 && part <= 255)) || return 1
  done
  return 0
}

probe_ip_port() {
  local ip="$1"
  local port="$2"
  python3 - "$ip" "$port" <<'PY'
import socket, sys
ip = sys.argv[1]
port = int(sys.argv[2])
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(0.35)
try:
    s.connect((ip, port))
except Exception:
    raise SystemExit(1)
finally:
    s.close()
raise SystemExit(0)
PY
}

ip_reachable() {
  local ip="$1"
  local ports_csv="$2"
  is_ipv4 "$ip" || return 1

  local compact="${ports_csv// /}"
  local old_ifs="$IFS"
  IFS=','
  # shellcheck disable=SC2206
  local ports=( $compact )
  IFS="$old_ifs"

  local port
  for port in "${ports[@]}"; do
    [[ -n "$port" ]] || continue
    if probe_ip_port "$ip" "$port"; then
      return 0
    fi
  done
  return 1
}

resolve_mode() {
  local mode
  mode="$(normalize_mode "$MODE_RAW")"
  if [[ "$mode" == "home" || "$mode" == "road" ]]; then
    printf "%s" "$mode"
    return
  fi

  if [[ -n "$HOME_IP" ]] && ip_reachable "$HOME_IP" "$PROBE_PORTS_RAW"; then
    printf "home"
    return
  fi

  if [[ -n "$ROAD_IP" ]] && ip_reachable "$ROAD_IP" "$PROBE_PORTS_RAW"; then
    printf "road"
    return
  fi

  if [[ -n "$HOME_IP" ]] && [[ -z "$ROAD_IP" ]]; then
    printf "home"
    return
  fi

  if [[ -n "$ROAD_IP" ]] && [[ -z "$HOME_IP" ]]; then
    printf "road"
    return
  fi

  # Unknown/offline state: default to home so local LAN routing is preferred.
  printf "home"
}

rewrite_url_host() {
  local value="$1"
  local target="$2"
  python3 - "$value" "$HOST_ALIAS" "$HOST_NAME" "$target" <<'PY'
import re
import sys
from urllib.parse import urlsplit, urlunsplit

value, alias, host_name, target = sys.argv[1:5]
aliases = {alias.lower(), host_name.lower()}

try:
    parts = urlsplit(value)
except Exception:
    parts = None

if parts and parts.scheme and parts.netloc and parts.hostname and parts.hostname.lower() in aliases:
    userinfo = ""
    if parts.username is not None:
        userinfo = parts.username
        if parts.password is not None:
            userinfo += f":{parts.password}"
        userinfo += "@"
    port = f":{parts.port}" if parts.port else ""
    netloc = f"{userinfo}{target}{port}"
    print(urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment)))
    raise SystemExit(0)

rewritten = value
for candidate in aliases:
    rewritten = re.sub(rf"@{re.escape(candidate)}(?=[:/])", f"@{target}", rewritten, flags=re.IGNORECASE)
print(rewritten)
PY
}

emit_var() {
  local key="$1"
  local value="$2"
  if [[ "$OUTPUT_FORMAT" == "plain" ]]; then
    printf "%s=%s\n" "$key" "$value"
  else
    printf "export %s=%q\n" "$key" "$value"
  fi
}

resolved_mode="$(resolve_mode)"
resolved_ip=""
if [[ "$resolved_mode" == "road" ]]; then
  resolved_ip="$ROAD_IP"
else
  resolved_ip="$HOME_IP"
fi

apns_production="false"
if [[ "$CURRENT_HOST_SHORT" == "$HOST_ALIAS_NORMALIZED" \
   || "$CURRENT_HOST_SHORT" == "$HOST_NAME_NORMALIZED" \
   || "$CURRENT_HOST" == "$HOST_ALIAS_NORMALIZED" \
   || "$CURRENT_HOST" == "$HOST_NAME_NORMALIZED" ]]; then
  apns_production="true"
fi
runtime_env="development"
if [[ "$apns_production" == "true" ]]; then
  runtime_env="production"
fi
emit_var "JOI_RUNTIME_ENV" "$runtime_env"
emit_var "APNS_PRODUCTION" "$apns_production"

if ! is_ipv4 "$resolved_ip"; then
  # No safe target to rewrite against.
  emit_var "JOI_MINI_ACTIVE_MODE" "$resolved_mode"
  exit 0
fi

emit_var "JOI_MINI_ACTIVE_MODE" "$resolved_mode"
emit_var "JOI_MINI_ACTIVE_IP" "$resolved_ip"

for key in DATABASE_URL OLLAMA_URL LIVEKIT_URL JOI_TTS_CACHE_REDIS_URL MEM0_PGVECTOR_DSN; do
  current="${!key-}"
  [[ -n "$current" ]] || continue
  rewritten="$(rewrite_url_host "$current" "$resolved_ip")"
  if [[ "$rewritten" != "$current" ]]; then
    emit_var "$key" "$rewritten"
  fi
done
