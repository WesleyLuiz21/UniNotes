#!/usr/bin/env bash
# Build and (re)deploy UniNotes safely.
#
#   ./scripts/deploy.sh              build all images, back up, migrate, start everything
#   ./scripts/deploy.sh frontend     rebuild/redeploy the frontend only (no DB impact)
#   ./scripts/deploy.sh backend      rebuild backend, back up, migrate explicitly, restart backend
#
# Data volumes are never removed. Migrations run only here, never implicitly on container start.
source "$(dirname "$0")/_common.sh"

SERVICE="${1:-all}"
[[ "$SERVICE" =~ ^(all|frontend|backend)$ ]] || die "Usage: deploy.sh [all|frontend|backend]"

for v in UNINOTES_ORIGIN APP_SECRET_KEY; do
  [[ -n "$(env_get "$v" || true)" ]] || die "$v is not set in .env"
done
[[ "$(env_get APP_SECRET_KEY | wc -c)" -ge 33 ]] || die "APP_SECRET_KEY must be at least 32 characters (openssl rand -base64 48)"
if [[ "$(stat -c %a .env 2>/dev/null || echo 600)" != 600 ]]; then log "WARNING: .env should be chmod 600"; fi


if [[ "$SERVICE" == frontend ]]; then
  dc build frontend
  dc up -d --no-deps frontend
  wait_healthy frontend
  exit 0
fi

log "Building images…"
if [[ "$SERVICE" == all ]]; then dc build; else dc build backend; fi

# Back up before touching the schema (skip on a brand-new install).
STATUS="$(dc run --rm --no-deps -T backend node dist/scripts/migrate.js --status 2>&1 || true)"
printf '%s\n' "$STATUS" >&2
if printf '%s' "$STATUS" | grep -qE 'Applied migrations: [1-9]'; then
  log "Backing up before migration…"
  "$ROOT/scripts/backup.sh" --local
fi

log "Applying database migrations (if any)…"
dc run --rm --no-deps -T backend node dist/scripts/migrate.js

if [[ "$SERVICE" == all ]]; then dc up -d; else dc up -d --no-deps backend; fi
wait_healthy backend
[[ "$SERVICE" == all ]] && wait_healthy frontend
log "Deployment complete."
if ! dc run --rm --no-deps -T backend node -e "
  const D=require('better-sqlite3');const d=new D('/data/db/uninotes.db',{readonly:true});
  process.exit(d.prepare('select count(*) n from users').get().n>0?0:1)" 2>/dev/null; then
  log "No account exists yet. Create one with:"
  log "  docker compose run --rm -it backend node dist/scripts/create-user.js"
fi
