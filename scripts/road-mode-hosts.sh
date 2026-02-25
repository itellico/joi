#!/usr/bin/env bash
set -euo pipefail

# Manage JOI road-mode host alias mapping for the mini server.
#
# Usage:
#   ./scripts/road-mode-hosts.sh status
#   ./scripts/road-mode-hosts.sh home [--apply]
#   ./scripts/road-mode-hosts.sh road [--apply]
#   ./scripts/road-mode-hosts.sh auto [--apply]
#
# Env overrides:
#   JOI_MINI_HOST_ALIAS (default: mini)
#   JOI_MINI_HOME_IP    (default: 192.168.178.58)
#   JOI_MINI_ROAD_IP    (default: tailscale ip -4 marcuss-mini)
#   JOI_MINI_PROBE_PORTS (default: 5434,11434,7880,22)
#   HOSTS_FILE          (default: /etc/hosts)

MODE="${1:-status}"
APPLY_FLAG="${2:-}"

HOST_ALIAS="${JOI_MINI_HOST_ALIAS:-mini}"
HOME_IP="${JOI_MINI_HOME_IP:-192.168.178.58}"

detect_tailscale_ip() {
  local target="${1:-marcuss-mini}"
  if command -v tailscale >/dev/null 2>&1; then
    tailscale ip -4 "$target" 2>/dev/null || true
    return
  fi
  if [[ -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]]; then
    /Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4 "$target" 2>/dev/null || true
    return
  fi
}

ROAD_IP_DEFAULT="$(detect_tailscale_ip "marcuss-mini")"
ROAD_IP="${JOI_MINI_ROAD_IP:-$ROAD_IP_DEFAULT}"
PROBE_PORTS_RAW="${JOI_MINI_PROBE_PORTS:-5434,11434,7880,22}"
HOSTS_FILE="${HOSTS_FILE:-/etc/hosts}"

if [[ "$MODE" != "status" && "$MODE" != "home" && "$MODE" != "road" && "$MODE" != "auto" ]]; then
  echo "Unknown mode: $MODE"
  echo "Use: status | home [--apply] | road [--apply] | auto [--apply]"
  exit 1
fi

if [[ "$MODE" != "status" && "$APPLY_FLAG" != "" && "$APPLY_FLAG" != "--apply" ]]; then
  echo "Unknown flag: $APPLY_FLAG"
  echo "Only --apply is supported."
  exit 1
fi

resolve_alias() {
  local alias="$1"
  python3 - "$alias" <<'PY'
import socket, sys
alias = sys.argv[1]
try:
    infos = socket.getaddrinfo(alias, None)
    out = []
    for item in infos:
        ip = item[4][0]
        if ip not in out:
            out.append(ip)
    print(", ".join(out))
except Exception as exc:
    print(f"unresolved ({exc})")
PY
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

detect_mode() {
  if ip_reachable "$HOME_IP" "$PROBE_PORTS_RAW"; then
    echo "home"
    return
  fi
  if [[ -n "$ROAD_IP" ]]; then
    if ip_reachable "$ROAD_IP" "$PROBE_PORTS_RAW"; then
      echo "road"
      return
    fi
    echo "road-unverified"
    return
  fi
  echo "unknown"
}

show_status() {
  local detected
  detected="$(detect_mode)"
  echo "JOI road-mode host status"
  echo "  alias      : $HOST_ALIAS"
  echo "  hosts file : $HOSTS_FILE"
  echo "  resolved   : $(resolve_alias "$HOST_ALIAS")"
  echo "  home ip    : $HOME_IP"
  echo "  road ip    : ${ROAD_IP:-<missing>}"
  echo "  probe ports: $PROBE_PORTS_RAW"
  echo "  detected   : $detected"
  echo "  hosts line :"
  awk -v alias="$HOST_ALIAS" '
  {
    line = $0
    body = line
    hash = index(line, "#")
    if (hash > 0) body = substr(line, 1, hash - 1)
    n = split(body, parts, /[[:space:]]+/)
    for (i = 2; i <= n; i++) {
      if (parts[i] == alias) {
        print NR ":" line
        found = 1
        break
      }
    }
  }
  END {
    if (!found) exit 1
  }' "$HOSTS_FILE" || echo "    (no explicit entry)"
}

write_hosts() {
  local target_ip="$1"
  local tmp
  tmp="$(mktemp)"

  awk -v alias="$HOST_ALIAS" '
  {
    line = $0
    body = line
    hash = index(line, "#")
    if (hash > 0) body = substr(line, 1, hash - 1)
    n = split(body, parts, /[[:space:]]+/)
    hasAlias = 0
    for (i = 2; i <= n; i++) {
      if (parts[i] == alias) {
        hasAlias = 1
        break
      }
    }
    if (!hasAlias) print line
  }' "$HOSTS_FILE" > "$tmp"
  printf "%s %s\n" "$target_ip" "$HOST_ALIAS" >> "$tmp"

  if [[ "$APPLY_FLAG" == "--apply" ]]; then
    if [[ "$HOSTS_FILE" == "/etc/hosts" ]]; then
      echo "Applying ${HOST_ALIAS} -> ${target_ip} to ${HOSTS_FILE} (sudo required)..."
      sudo cp "$tmp" "$HOSTS_FILE"
      sudo dscacheutil -flushcache >/dev/null 2>&1 || true
    else
      echo "Applying ${HOST_ALIAS} -> ${target_ip} to ${HOSTS_FILE}..."
      cp "$tmp" "$HOSTS_FILE"
    fi
    echo "Applied."
  else
    echo "Preview only (no changes). Use --apply to write."
    echo "Would set: ${HOST_ALIAS} -> ${target_ip}"
    echo
    echo "Diff preview:"
    diff -u "$HOSTS_FILE" "$tmp" || true
  fi

  rm -f "$tmp"
}

case "$MODE" in
  status)
    show_status
    ;;
  home)
    write_hosts "$HOME_IP"
    ;;
  road)
    if [[ -z "$ROAD_IP" ]]; then
      echo "Road IP is empty. Set JOI_MINI_ROAD_IP or install tailscale CLI."
      exit 1
    fi
    write_hosts "$ROAD_IP"
    ;;
  auto)
    detected="$(detect_mode)"
    case "$detected" in
      home)
        echo "Auto detected HOME network."
        write_hosts "$HOME_IP"
        ;;
      road)
        if [[ -z "$ROAD_IP" ]]; then
          echo "Road IP is empty. Set JOI_MINI_ROAD_IP or install tailscale CLI."
          exit 1
        fi
        echo "Auto detected ROAD network."
        write_hosts "$ROAD_IP"
        ;;
      road-unverified)
        if [[ -z "$ROAD_IP" ]]; then
          echo "Road IP is empty. Set JOI_MINI_ROAD_IP or install tailscale CLI."
          exit 1
        fi
        echo "Home IP is not reachable. Falling back to ROAD IP (unverified reachability)."
        write_hosts "$ROAD_IP"
        ;;
      *)
        echo "Unable to auto-detect mode. Home and road addresses are both unreachable."
        echo "Run with explicit mode: home --apply or road --apply"
        exit 1
        ;;
    esac
    ;;
esac
