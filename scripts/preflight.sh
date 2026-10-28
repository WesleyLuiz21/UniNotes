#!/usr/bin/env bash
# READ-ONLY pre-deployment checks for the production VPS (host Caddy + compose.existing-proxy.yaml).
# Changes nothing. Exits non-zero if any check FAILs (warnings do not fail).
#
#   ./scripts/preflight.sh               run from /srv/UniNotes/app
#   ./scripts/preflight.sh --skip-dns    skip the DNS check (local testing)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fails=0
ok()   { printf '  \033[32mOK\033[0m    %s\n' "$*"; }
warn() { printf '  \033[33mWARN\033[0m  %s\n' "$*"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; fails=$((fails + 1)); }
hdr()  { printf '\n== %s\n' "$*"; }
SKIP_DNS=false; [[ "${1:-}" == "--skip-dns" ]] && SKIP_DNS=true

envv() { [[ -f .env ]] && grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
COMPOSE_FILE_PATH="$(envv UNINOTES_COMPOSE_FILE)"; COMPOSE_FILE_PATH="${COMPOSE_FILE_PATH:-compose.existing-proxy.yaml}"
DATA_DIR="$(envv UNINOTES_DATA_DIR)"; DATA_DIR="${DATA_DIR:-/srv/UniNotes/data}"
BACKUP_DIR="$(envv UNINOTES_BACKUP_DIR)"; BACKUP_DIR="${BACKUP_DIR:-/srv/UniNotes/backups}"
BPORT="$(envv UNINOTES_BACKEND_HOST_PORT)"; BPORT="${BPORT:-3002}"
FPORT="$(envv UNINOTES_FRONTEND_HOST_PORT)"; FPORT="${FPORT:-3003}"
EXPECTED_IP="$(envv UNINOTES_EXPECTED_IP)"; EXPECTED_IP="${EXPECTED_IP:-178.62.99.141}"
ORIGIN="$(envv UNINOTES_ORIGIN)"

hdr "Docker"
if docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then ok "Docker Engine $(docker version --format '{{.Server.Version}}')"; else bad "Docker not reachable by this user"; fi
if docker compose version >/dev/null 2>&1; then ok "$(docker compose version)"; else bad "Docker Compose plugin missing"; fi

hdr ".env"
if [[ ! -f .env ]]; then
  bad ".env missing (cp .env.example .env && chmod 600 .env, then fill it in)"
else
  mode="$(stat -c %a .env)"; [[ "$mode" == 600 ]] && ok ".env mode 600" || bad ".env mode is $mode (chmod 600 .env)"
  [[ "$COMPOSE_FILE_PATH" == compose.existing-proxy.yaml ]] && ok "UNINOTES_COMPOSE_FILE=compose.existing-proxy.yaml" \
    || bad "UNINOTES_COMPOSE_FILE=$COMPOSE_FILE_PATH (the VPS must use compose.existing-proxy.yaml)"
  if [[ "$ORIGIN" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then ok "UNINOTES_ORIGIN=$ORIGIN"; else bad "UNINOTES_ORIGIN must be https://<host> without a trailing slash (got '${ORIGIN}')"; fi
  key="$(envv APP_SECRET_KEY)"
  if [[ ${#key} -lt 32 ]]; then bad "APP_SECRET_KEY missing or shorter than 32 characters (openssl rand -base64 48)"
  elif [[ "$key" =~ (change-?me|example|placeholder|secret) ]]; then bad "APP_SECRET_KEY looks like a placeholder"
  else ok "APP_SECRET_KEY set (${#key} characters)"; fi
  [[ "$(envv UNINOTES_COOKIE_SECURE)" == false ]] && bad "UNINOTES_COOKIE_SECURE=false (must be true behind HTTPS)"
fi

hdr "Compose configuration ($COMPOSE_FILE_PATH)"
if cfg="$(docker compose -f "$COMPOSE_FILE_PATH" config --format json 2>&1)"; then
  ok "docker compose config is valid"
  res="$(UNINOTES_CFG="$cfg" python3 - "$DATA_DIR" "$BACKUP_DIR" <<'PY'
import json, os, sys
c = json.loads(os.environ["UNINOTES_CFG"])
data, backups = sys.argv[1].rstrip("/"), sys.argv[2].rstrip("/")
def out(status, msg):
    print(status + "|" + msg)
name = c.get("name")
out("OK" if name == "uninotes" else "FAIL", "project name is %r (must be uninotes)" % name)
services = c.get("services", {})
out("OK" if set(services) == {"backend", "frontend"} else "FAIL",
    "services: %s (expected backend, frontend; no proxy container)" % sorted(services))
for n, svc in services.items():
    for p in svc.get("ports", []):
        ip = p.get("host_ip") or "0.0.0.0"
        out("OK" if ip == "127.0.0.1" else "FAIL", "%s: port %s:%s -> %s" % (n, ip, p.get("published"), p.get("target")))
    for v in svc.get("volumes", []):
        if v.get("type") == "bind":
            src = v["source"].rstrip("/")
            under = src.startswith(data + "/") or src == backups
            out("OK" if under else "WARN", "%s: bind %s -> %s" % (n, v["source"], v["target"]))
ext = [k for k, v in c.get("networks", {}).items() if v.get("external")]
out("OK" if not ext else "FAIL", "no external networks" if not ext else "external networks: %s" % ext)
names = sorted(svc.get("container_name", "") for svc in services.values())
out("OK" if names == ["uninotes-backend", "uninotes-frontend"] else "FAIL", "container names: %s" % names)
PY
)"
  while IFS='|' read -r s m; do
    case "$s" in OK) ok "$m" ;; WARN) warn "$m" ;; *) bad "$m" ;; esac
  done <<< "$res"
else
  bad "docker compose config failed: $(printf '%s' "$cfg" | tr '\n' ' ')"
fi

hdr "Data and backup directories (must be owned by uid 1000 = container user)"
for d in "$DATA_DIR/db" "$DATA_DIR/attachments" "$BACKUP_DIR"; do
  if [[ ! -d "$d" ]]; then bad "$d does not exist (mkdir -p and chown 1000:1000, chmod 700)"; continue; fi
  owner="$(stat -c %u "$d")"; mode="$(stat -c %a "$d")"
  [[ "$owner" == 1000 ]] && ok "$d owner uid 1000" || bad "$d is owned by uid $owner (chown 1000:1000 $d)"
  [[ "$mode" == 700 || "$mode" == 750 ]] || warn "$d mode $mode (700 recommended: private notes and attachments)"
done
case "$(realpath -m "$DATA_DIR")/" in "$(pwd)/"*) warn "data dir is inside the git checkout; keep it outside (/srv/UniNotes/data)";; esac

hdr "Ports (loopback)"
for p in "$BPORT" "$FPORT"; do
  if [[ "$p" == 3001 || "$p" == 2019 ]]; then bad "port $p is reserved (Notes API / Caddy admin)"; continue; fi
  owner="$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E ":${p}->" | awk '{print $1}' | paste -sd, -)"
  listen="$( (ss -ltnH "sport = :$p" 2>/dev/null || true) | head -n1)"
  if [[ -n "$owner" ]]; then [[ "$owner" =~ ^uninotes- ]] && ok "port $p used by $owner (UniNotes)" || bad "port $p is used by $owner"
  elif [[ -n "$listen" ]]; then bad "port $p is in use by a host process"
  else ok "port $p is free"; fi
done

hdr "Other applications (informational; never modified)"
for c in $(docker ps -a --format '{{.Names}}'); do
  proj="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$c" 2>/dev/null)"
  [[ "$proj" == uninotes ]] && continue
  ok "container '$c' (project '${proj:-none}') present; UniNotes does not manage it"
done

hdr "Host Caddy"
if systemctl is-active --quiet caddy >/dev/null 2>&1; then ok "caddy.service is active"; else warn "caddy.service is not active on this host"; fi
if [[ -r /etc/caddy/Caddyfile ]]; then
  host="${ORIGIN#https://}"
  if [[ -n "$host" ]] && grep -q "^${host//./\\.}" /etc/caddy/Caddyfile; then ok "Caddyfile has a block for $host"
  else warn "Caddyfile has no block for ${host:-the UniNotes host} yet (add deploy/Caddyfile.university after the containers are healthy)"; fi
fi

hdr "DNS"
if [[ "$SKIP_DNS" == true ]]; then warn "DNS check skipped"
elif [[ -n "$ORIGIN" ]]; then
  host="${ORIGIN#https://}"
  a="$(getent ahostsv4 "$host" 2>/dev/null | awk '{print $1}' | sort -u | paste -sd, -)"
  [[ "$a" == "$EXPECTED_IP" ]] && ok "$host -> $a" || bad "$host resolves to '${a:-nothing}' (expected $EXPECTED_IP). Add the A record first."
  aaaa="$(getent ahostsv6 "$host" 2>/dev/null | awk '$1 ~ /:/ && $1 !~ /^::ffff:/ {print $1}' | sort -u | paste -sd, -)"
  [[ -z "$aaaa" ]] && ok "no AAAA record (the droplet has no IPv6)" || bad "$host has an AAAA record ($aaaa) but the droplet has no IPv6"
fi

hdr "Resources"
mem="$(awk '/MemAvailable/ {printf "%d", $2/1024}' /proc/meminfo)"
swap="$(awk '/SwapTotal/ {printf "%d", $2/1024}' /proc/meminfo)"
ok "available memory ${mem} MiB, swap ${swap} MiB (UniNotes runtime limit: 512 + 64 MiB)"
(( swap == 0 )) && warn "no swap: build images off-box (scripts/build-images.sh + ship-images.sh) and deploy with --no-build"
disk="$(df -Pm /var/lib/docker 2>/dev/null | awk 'NR==2 {print $4}')"
[[ -n "$disk" ]] && { (( disk >= 4000 )) && ok "free disk for Docker: ${disk} MiB" || warn "free disk for Docker: ${disk} MiB"; }

echo
if (( fails > 0 )); then printf '\033[31m%d check(s) failed.\033[0m Nothing was changed.\n' "$fails"; exit 1; fi
printf '\033[32mAll required checks passed.\033[0m Nothing was changed.\n'
