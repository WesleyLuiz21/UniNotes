#!/usr/bin/env bash
# Return UniNotes to an earlier release (image tag). Never touches Caddy, DNS or other applications.
#
#   ./scripts/rollback.sh                          previous release (recorded by deploy.sh)
#   ./scripts/rollback.sh --to <tag>               a specific tag (git short SHA); see --list
#   ./scripts/rollback.sh --to <tag> --restore-db <backup|latest>
#                                                  also restore a database backup taken before the
#                                                  newer release migrated the schema
#   ./scripts/rollback.sh --list                   show available release images
#   add --yes to skip the confirmation prompt
#
# Older code cannot safely run on a schema that a newer release migrated. If the database is ahead
# of the target release, this script refuses unless --restore-db (or --force) is given.
source "$(dirname "$0")/_common.sh"

TARGET=""; RESTORE=""; YES=false; FORCE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --to) TARGET="${2:?--to needs a tag}"; shift ;;
    --restore-db) RESTORE="${2:?--restore-db needs a backup name or latest}"; shift ;;
    --yes) YES=true ;;
    --force) FORCE=true ;;
    --list)
      log "Deployed: $(current_tag) | previous: $(previous_tag)"
      docker image ls uninotes-backend --format '{{.Tag}}\t{{.CreatedSince}}' | grep -v '<none>' || true
      exit 0 ;;
    *) die "Unknown option: $1 (see the header of this script)" ;;
  esac
  shift
done

TARGET="${TARGET:-$(previous_tag)}"
[[ -n "$TARGET" ]] || die "No previous release recorded; pass --to <tag> (see --list)"
[[ "$TARGET" =~ ^[A-Za-z0-9._-]+$ ]] || die "Invalid tag"
for img in "uninotes-backend:$TARGET" "uninotes-frontend:$TARGET"; do
  image_exists "$img" || die "Image $img is not available on this host"
done
FROM="$(current_tag)"
export UNINOTES_TAG="$TARGET"

# Schema compatibility: how many migrations does the database have vs. the target release know?
STATUS="$(dc run --rm --no-deps -T backend node dist/scripts/migrate.js --status 2>&1 || true)"
applied="$(printf '%s' "$STATUS" | sed -nE 's/.*Applied migrations: ([0-9]+)\/([0-9]+).*/\1/p')"
known="$(printf '%s' "$STATUS" | sed -nE 's/.*Applied migrations: ([0-9]+)\/([0-9]+).*/\2/p')"
if [[ -n "$applied" && -n "$known" && "$applied" -gt "$known" && -z "$RESTORE" && "$FORCE" != true ]]; then
  die "The database has $applied migrations but release $TARGET knows only $known. Restore a backup taken
       before the upgrade with --restore-db <backup> (see ./scripts/restore.sh --list), or --force."
fi

if [[ "$YES" != true ]]; then
  read -r -p "Roll back from ${FROM:-?} to $TARGET${RESTORE:+ and restore database backup $RESTORE}? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || die "Aborted"
fi

if [[ -n "$RESTORE" ]]; then
  # restore.sh stops the backend, preserves the current data, restores, migrates with $TARGET's code
  # and starts the backend on $TARGET.
  "$ROOT/scripts/restore.sh" "$RESTORE" --yes
fi

log "Starting release $TARGET…"
dc up -d backend frontend
wait_healthy backend 120
wait_healthy frontend 60
"$ROOT/scripts/healthcheck.sh" --local

mkdir -p "$STATE_DIR"
[[ -n "$FROM" && "$FROM" != "$TARGET" ]] && printf '%s\n' "$FROM" > "$STATE_DIR/.previous_tag"
printf '%s\n' "$TARGET" > "$STATE_DIR/.last_good_tag"
log "Rolled back to $TARGET."
