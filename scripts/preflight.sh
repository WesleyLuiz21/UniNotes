#!/usr/bin/env bash
# READ-ONLY pre-deployment check for a VPS that already runs other Docker applications.
# It changes nothing: it only inspects ports, containers, networks, volumes and resources,
# then recommends a reverse-proxy mode for UniNotes.
#
#   ./scripts/preflight.sh            (run from the UniNotes directory on the VPS)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

ok()   { printf '  \033[32mOK\033[0m    %s\n' "$*"; }
warn() { printf '  \033[33mWARN\033[0m  %s\n' "$*"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; }
hdr()  { printf '\n== %s\n' "$*"; }

PROJECT="$( (grep -E '^COMPOSE_PROJECT_NAME=' .env 2>/dev/null || echo COMPOSE_PROJECT_NAME=uninotes) | tail -n1 | cut -d= -f2)"
HTTP_PORT="$( (grep -E '^UNINOTES_HTTP_PORT=' .env 2>/dev/null || echo X=80) | tail -n1 | cut -d= -f2)"
HTTPS_PORT="$( (grep -E '^UNINOTES_HTTPS_PORT=' .env 2>/dev/null || echo X=443) | tail -n1 | cut -d= -f2)"

hdr "Docker"
if docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then ok "Docker Engine $(docker version --format '{{.Server.Version}}')"; else bad "Docker not reachable by this user"; fi
if docker compose version >/dev/null 2>&1; then ok "$(docker compose version)"; else bad "Docker Compose plugin missing"; fi
DAEMON=/etc/docker/daemon.json
if [[ -r $DAEMON ]]; then
  grep -q '"userland-proxy" *: *true' $DAEMON && warn "userland-proxy enabled: clients may appear with a Docker IP (per-IP limits weaken)"
  grep -q '"iptables" *: *false' $DAEMON && bad "iptables disabled in daemon.json: published ports/networks will not work as expected"
fi

hdr "Name collisions with project '$PROJECT'"
c="$(docker ps -a --format '{{.Names}}' | grep -E "^${PROJECT}[-_]" || true)"
v="$(docker volume ls -q | grep -E "^${PROJECT}_" || true)"
n="$(docker network ls --format '{{.Name}}' | grep -E "^${PROJECT}_" || true)"
if [[ -z "$c$v$n" ]]; then ok "no existing containers/volumes/networks use the '$PROJECT' prefix"
else warn "existing resources already use '$PROJECT' (fine if they are UniNotes; otherwise change COMPOSE_PROJECT_NAME):"; printf '        %s\n' $c $v $n; fi

hdr "Ports"
for p in 80 443 "$HTTP_PORT" "$HTTPS_PORT"; do
  [[ -n "${seen:-}" && " $seen " == *" $p "* ]] && continue; seen="${seen:-} $p"
  owner="$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E "(0\.0\.0\.0|\[::\]|127\.0\.0\.1|:):${p}->" | awk '{print $1}' | paste -sd, -)"
  listen="$( (ss -ltnH "sport = :$p" 2>/dev/null || true) | head -n1)"
  if [[ -n "$owner" ]]; then warn "port $p is published by container(s): $owner"
  elif [[ -n "$listen" ]]; then proc="$( (sudo -n ss -ltnpH "sport = :$p" 2>/dev/null || ss -ltnpH "sport = :$p" 2>/dev/null) | grep -o 'users:((.*))' | head -n1)"; warn "port $p is in use by a host process ${proc:-(run with sudo to see which)}"
  else ok "port $p is free"; fi
done

hdr "Existing reverse proxies"
# Candidate proxies: proxy-like images that publish host ports (excluding UniNotes itself).
PROXIES="$(docker ps --format '{{.Names}}|{{.Image}}|{{.Ports}}' | grep -Ei 'traefik|nginx|caddy|haproxy|envoy|swag|npm|proxy' | grep -v "^${PROJECT}-" | awk -F'|' '$3 ~ /->/' || true)"
if [[ -n "$PROXIES" ]]; then
  while IFS='|' read -r name image ports; do
    nets="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$name")"
    warn "container '$name' ($image) ports: ${ports:-none} networks: $nets"
  done <<< "$PROXIES"
fi
if [[ -d /run/systemd/system ]]; then
  for svc in nginx apache2 httpd caddy traefik haproxy; do
    systemctl is-active --quiet "$svc" 2>/dev/null && warn "host service '$svc' is running"
  done
fi
[[ -z "$PROXIES" ]] && ok "no containerised reverse proxy detected"

hdr "Resources"
mem="$(awk '/MemAvailable/ {printf "%d", $2/1024}' /proc/meminfo)"
(( mem >= 900 )) && ok "available memory: ${mem} MiB (UniNotes is capped at ~770 MiB)" || warn "available memory: ${mem} MiB — UniNotes is capped at ~770 MiB; consider a swap file or larger Droplet"
disk="$(df -Pm /var/lib/docker 2>/dev/null | awk 'NR==2 {print $4}')"
[[ -n "$disk" ]] && { (( disk >= 4000 )) && ok "free disk for Docker: ${disk} MiB" || warn "free disk for Docker: ${disk} MiB (images + backups need several GB)"; }

hdr "Firewall"
if command -v ufw >/dev/null 2>&1; then (sudo -n ufw status 2>/dev/null || echo "  (run with sudo to read ufw status)") | sed 's/^/        /'; else warn "ufw not installed (DigitalOcean Cloud Firewall is also fine)"; fi

hdr "Recommendation"
p80="$(docker ps --format '{{.Ports}}' | grep -cE ':(80|443)->')"
h80="$( (ss -ltnH 'sport = :80' 2>/dev/null; ss -ltnH 'sport = :443' 2>/dev/null) | wc -l)"
if [[ "$p80" -eq 0 && "$h80" -eq 0 ]]; then
  echo "  Ports 80/443 are free -> Option A (bundled Caddy with automatic HTTPS). No changes to other apps."
elif [[ -n "$PROXIES" ]]; then
  echo "  A containerised proxy owns 80/443 -> Option C: compose.existing-proxy.yaml (join its network,"
  echo "  publish no ports) and add ONE route for your UniNotes domain in that proxy. See README."
else
  echo "  A host service or container owns 80/443 -> Option B: bind UniNotes to 127.0.0.1:8088 and add ONE"
  echo "  server block for your UniNotes domain to the existing proxy. If 80/443 belong to an application"
  echo "  without a reverse proxy, a shared proxy is required — that changes the other app; decide first."
fi
