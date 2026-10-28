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

# Which compose file to drive. Production VPS (host Caddy): compose.existing-proxy.yaml (default).
# compose.yaml (bundled Caddy on 80/443) is only for hosts where nothing else owns 80/443.
COMPOSE_FILE_PATH="$(env_get UNINOTES_COMPOSE_FILE || true)"
COMPOSE_FILE_PATH="${COMPOSE_FILE_PATH:-compose.existing-proxy.yaml}"
case "$COMPOSE_FILE_PATH" in
  compose.existing-proxy.yaml | compose.yaml) ;;
  *) die "UNINOTES_COMPOSE_FILE must be compose.existing-proxy.yaml or compose.yaml" ;;
esac

# Deployment state (current/previous image tags) lives OUTSIDE the git checkout so that
# `git clean`/re-cloning can never lose it. Default /srv/UniNotes on the VPS.
STATE_DIR="$(env_get UNINOTES_STATE_DIR || true)"
STATE_DIR="${STATE_DIR:-/srv/UniNotes}"
current_tag() { cat "$STATE_DIR/.last_good_tag" 2>/dev/null || true; }
previous_tag() { cat "$STATE_DIR/.previous_tag" 2>/dev/null || true; }

# The image tag every compose command uses: an explicit UNINOTES_TAG (deploy/rollback), else the
# last successfully deployed tag, else "latest". This keeps ad-hoc commands from recreating
# containers with a different image than the one deployed.
export UNINOTES_TAG="${UNINOTES_TAG:-$(current_tag)}"
export UNINOTES_TAG="${UNINOTES_TAG:-latest}"

# Always the explicit file and project: never a bare `docker compose`, which could pick up the
# wrong file, and never anything that could touch another project.
dc() { docker compose -f "$ROOT/$COMPOSE_FILE_PATH" "$@"; }

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

# wait_healthy <service> [timeout-seconds]; returns non-zero (does not exit) on timeout.
wait_healthy() {
  local svc="$1" timeout="${2:-120}" cid status waited=0
  while (( waited < timeout )); do
    cid="$(dc ps -q "$svc")"
    status="$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo starting)"
    [[ "$status" == healthy ]] && { log "$svc is healthy"; return 0; }
    sleep 2; waited=$((waited + 2))
  done
  dc logs --tail 50 "$svc" >&2 || true
  log "$svc did not become healthy within ${timeout}s"
  return 1
}

image_exists() { docker image inspect "$1" >/dev/null 2>&1; }
