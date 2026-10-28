#!/usr/bin/env bash
# Deploy (or redeploy) UniNotes on the VPS. Never touches Caddy, DNS or any other application.
#
#   ./scripts/deploy.sh                    deploy the current checkout (HEAD)
#   ./scripts/deploy.sh --ref v1.4         fetch and check out a tag/branch/commit first
#   ./scripts/deploy.sh --no-build         use images already loaded for this commit
#                                          (built off-box: scripts/build-images.sh + ship-images.sh)
#   ./scripts/deploy.sh --skip-preflight   (not recommended)
#   UNINOTES_PREFLIGHT_ARGS=--skip-dns ./scripts/deploy.sh   (local testing without DNS)
#
# Steps: preflight -> checkout -> images for tag <git short SHA> -> backup -> migrate -> up ->
# health gates -> record the tag as last-good. If the new release does not become healthy, the
# previous good tag is started again automatically (database migrations are NOT undone; see
# scripts/rollback.sh --restore-db).
source "$(dirname "$0")/_common.sh"

REF=""; BUILD=true; PREFLIGHT=true; PASS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="${2:?--ref needs a value}"; shift ;;
    --no-build) BUILD=false; PASS+=("$1") ;;
    --skip-preflight) PREFLIGHT=false; PASS+=("$1") ;;
    *) die "Unknown option: $1 (see the header of this script)" ;;
  esac
  shift
done

if [[ -n "$REF" ]]; then
  [[ -z "$(git status --porcelain --untracked-files=no)" ]] || die "Working tree has local changes; refusing to check out $REF"
  log "Checking out $REF…"
  git fetch --tags --quiet origin
  git checkout --quiet --detach "$REF"
  # Continue with the deploy logic of the release being deployed.
  exec "$ROOT/scripts/deploy.sh" "${PASS[@]}"
fi

if [[ "$PREFLIGHT" == true ]]; then
  log "Running preflight checks…"
  "$ROOT/scripts/preflight.sh" ${UNINOTES_PREFLIGHT_ARGS:-} || die "Preflight failed; nothing was changed"
fi

NEW_TAG="$(git rev-parse --short=12 HEAD)"
OLD_TAG="$(current_tag)"
export UNINOTES_TAG="$NEW_TAG"
log "Deploying $NEW_TAG (currently deployed: ${OLD_TAG:-none})"

if [[ "$BUILD" == true ]]; then
  avail="$(awk '/MemAvailable/ {printf "%d", $2/1024}' /proc/meminfo)"
  swap="$(awk '/SwapTotal/ {printf "%d", $2/1024}' /proc/meminfo)"
  if (( swap == 0 && avail < 2500 )); then
    log "WARNING: ${avail} MiB available and no swap. Image builds peak at ~1.1 GiB and could trigger the"
    log "         OOM killer (which may hit other applications). Prefer building off-box, or add swap first."
  fi
  # One service at a time keeps peak memory at a single build.
  log "Building backend image…";  dc build backend
  log "Building frontend image…"; dc build frontend
else
  for img in "uninotes-backend:$NEW_TAG" "uninotes-frontend:$NEW_TAG"; do
    image_exists "$img" || die "Image $img not found. Build/ship it first or drop --no-build."
  done
fi

# Back up before touching the schema (skip on a brand-new install with no database yet).
STATUS="$(dc run --rm --no-deps -T backend node dist/scripts/migrate.js --status 2>&1 || true)"
printf '%s\n' "$STATUS" >&2
if printf '%s' "$STATUS" | grep -qE 'Applied migrations: [1-9]'; then
  log "Backing up before migrating…"
  "$ROOT/scripts/backup.sh" --local
fi

log "Applying database migrations (if any)…"
dc run --rm --no-deps -T backend node dist/scripts/migrate.js

log "Starting containers…"
ok=true
# `up` itself fails when the new backend never becomes healthy (the frontend waits for it); that
# must lead to the rollback below, not abort the script with the site half-replaced.
dc up -d backend frontend || ok=false
[[ "$ok" == true ]] && { wait_healthy backend 120 || ok=false; }
[[ "$ok" == true ]] && { wait_healthy frontend 60 || ok=false; }
[[ "$ok" == true ]] && { "$ROOT/scripts/healthcheck.sh" --local || ok=false; }

if [[ "$ok" != true ]]; then
  if [[ -n "$OLD_TAG" && "$OLD_TAG" != "$NEW_TAG" ]] && image_exists "uninotes-backend:$OLD_TAG"; then
    log "Release $NEW_TAG is unhealthy. Rolling back to $OLD_TAG…"
    UNINOTES_TAG="$OLD_TAG" dc up -d backend frontend || true
    if UNINOTES_TAG="$OLD_TAG" wait_healthy backend 120 && UNINOTES_TAG="$OLD_TAG" wait_healthy frontend 60; then
      log "Rolled back to $OLD_TAG (healthy)."
    else
      log "Rollback to $OLD_TAG did NOT become healthy: check ./scripts/compose.sh logs backend"
    fi
    log "If $NEW_TAG applied a migration, the old code may not match the"
    log "schema: run ./scripts/rollback.sh --to $OLD_TAG --restore-db latest if anything misbehaves."
  else
    log "Release $NEW_TAG is unhealthy and there is no previous release to return to."
  fi
  die "Deployment of $NEW_TAG failed"
fi

mkdir -p "$STATE_DIR"
if [[ -n "$OLD_TAG" && "$OLD_TAG" != "$NEW_TAG" ]]; then printf '%s\n' "$OLD_TAG" > "$STATE_DIR/.previous_tag"; fi
printf '%s\n' "$NEW_TAG" > "$STATE_DIR/.last_good_tag"
log "Deployment of $NEW_TAG complete."

if ! dc exec -T backend node -e "
  const D=require('better-sqlite3');const d=new D('/data/db/uninotes.db',{readonly:true});
  process.exit(d.prepare('select count(*) n from users').get().n>0?0:1)" 2>/dev/null; then
  log "No account exists yet. Create one with:"
  log "  ./scripts/compose.sh run --rm -it backend node dist/scripts/create-user.js"
fi
