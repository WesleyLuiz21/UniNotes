#!/usr/bin/env bash
# Shared helpers for UniNotes operational scripts. Sourced, not executed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

[[ -f .env ]] || die ".env not found in $ROOT (copy .env.example to .env and fill it in)"
# Read only the variables the scripts need, without executing .env as code.
env_get() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }

dc() { docker compose "$@"; }

backend_running() { [[ -n "$(dc ps --status running -q backend 2>/dev/null)" ]]; }

# Run a command in the backend environment (exec into the running container, else a one-off container).
backend_cmd() {
  if backend_running; then dc exec -T backend "$@"; else dc run --rm --no-deps -T backend "$@"; fi
}

notify() {
  local url; url="$(env_get BACKUP_NOTIFY_URL || true)"
  [[ -z "$url" ]] && return 0
  if [[ "$1" == "fail" ]]; then curl -fsS -m 10 --retry 3 "$url/fail" >/dev/null || true
  else curl -fsS -m 10 --retry 3 "$url" >/dev/null || true; fi
}

wait_healthy() {
  local svc="$1" i cid status
  for i in $(seq 1 60); do
    cid="$(dc ps -q "$svc")"
    status="$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo starting)"
    [[ "$status" == healthy ]] && { log "$svc is healthy"; return 0; }
    sleep 2
  done
  dc logs --tail 50 "$svc" >&2
  die "$svc did not become healthy"
}
