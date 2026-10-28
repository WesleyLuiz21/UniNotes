#!/usr/bin/env bash
# Check that UniNotes is up. Read-only.
#
#   ./scripts/healthcheck.sh            local container checks + the public URL (UNINOTES_ORIGIN)
#   ./scripts/healthcheck.sh --local    local checks only (used by deploy/rollback)
#
# Exits non-zero if any check fails.
source "$(dirname "$0")/_common.sh"

LOCAL_ONLY=false
[[ "${1:-}" == "--local" ]] && LOCAL_ONLY=true

BACKEND_PORT="$(env_get UNINOTES_BACKEND_HOST_PORT || true)"; BACKEND_PORT="${BACKEND_PORT:-3002}"
FRONTEND_PORT="$(env_get UNINOTES_FRONTEND_HOST_PORT || true)"; FRONTEND_PORT="${FRONTEND_PORT:-3003}"
fail=0
check() { # check <label> <command…>
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then log "OK    $label"; else log "FAIL  $label"; fail=1; fi
}
body_has() { curl -fsS -m 10 "$1" | grep -q "$2"; }

if [[ "$COMPOSE_FILE_PATH" == compose.existing-proxy.yaml ]]; then
  for svc in backend frontend; do
    cid="$(dc ps -q "$svc" 2>/dev/null || true)"
    check "container uninotes-$svc is healthy" test "$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null)" = healthy
  done
  check "backend  http://127.0.0.1:$BACKEND_PORT/api/health" body_has "http://127.0.0.1:$BACKEND_PORT/api/health" '"status":"ok"'
  check "frontend http://127.0.0.1:$FRONTEND_PORT/ serves the app" body_has "http://127.0.0.1:$FRONTEND_PORT/" '<div id="root">'
  check "frontend SPA fallback (deep link)" body_has "http://127.0.0.1:$FRONTEND_PORT/notes/some/deep/link" '<div id="root">'
fi

if [[ "$LOCAL_ONLY" != true ]]; then
  ORIGIN="$(env_get UNINOTES_ORIGIN || true)"
  if [[ -n "$ORIGIN" ]]; then
    check "public $ORIGIN/api/health" body_has "$ORIGIN/api/health" '"status":"ok"'
    check "public $ORIGIN/ serves the app" body_has "$ORIGIN/" '<div id="root">'
  fi
fi

exit "$fail"
