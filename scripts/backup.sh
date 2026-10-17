#!/usr/bin/env bash
# Create a consistent, verified UniNotes backup and (optionally) copy it offsite with restic.
#
#   ./scripts/backup.sh            local backup + restic upload/retention if RESTIC_REPOSITORY is set
#   ./scripts/backup.sh --local    local backup only
#   ./scripts/backup.sh --check    also run `restic check` (integrity of the offsite repository)
#
# Schedule daily via cron, e.g.:  15 3 * * * /opt/UniNotes/scripts/backup.sh >> /var/log/uninotes-backup.log 2>&1
# Failures exit non-zero, are logged, and ping BACKUP_NOTIFY_URL/fail if configured.
source "$(dirname "$0")/_common.sh"

LOCAL_ONLY=false; CHECK=false
for a in "$@"; do
  case "$a" in
    --local) LOCAL_ONLY=true ;;
    --check) CHECK=true ;;
    *) die "Unknown option: $a" ;;
  esac
done

trap 'log "Backup FAILED"; notify fail' ERR

log "Creating local snapshot (SQLite online backup + attachments + manifest)…"
OUT="$(backend_cmd node dist/scripts/backup.js)"
printf '%s\n' "$OUT" | sed '$d' >&2
DIR_IN_BACKEND="$(printf '%s\n' "$OUT" | tail -n1 | tr -d '\r')"
[[ "$DIR_IN_BACKEND" == /data/backups/local/* ]] || die "Unexpected backup path: $DIR_IN_BACKEND"
NAME="$(basename "$DIR_IN_BACKEND")"
log "Local backup verified: $NAME"

REPO="$(env_get RESTIC_REPOSITORY || true)"
if [[ "$LOCAL_ONLY" == false && -n "$REPO" ]]; then
  [[ -n "$(env_get RESTIC_PASSWORD || true)" ]] || die "RESTIC_PASSWORD is empty"
  if [[ "$REPO" == /repo* ]]; then mkdir -p "$(env_get RESTIC_LOCAL_REPO_DIR || echo ./restic-repo)"; fi
  if ! dc --profile tools run --rm -T restic cat config >/dev/null 2>&1; then
    log "Initialising restic repository…"
    dc --profile tools run --rm -T restic init
  fi
  log "Uploading to restic repository…"
  dc --profile tools run --rm -T restic backup --tag uninotes --host "$(env_get COMPOSE_PROJECT_NAME || echo uninotes)" "/backups/local/$NAME"
  log "Applying retention policy…"
  dc --profile tools run --rm -T restic forget --tag uninotes --prune \
    --keep-daily "$(env_get RESTIC_KEEP_DAILY || echo 30)" \
    --keep-weekly "$(env_get RESTIC_KEEP_WEEKLY || echo 8)" \
    --keep-monthly "$(env_get RESTIC_KEEP_MONTHLY || echo 6)"
  if [[ "$CHECK" == true ]]; then
    log "Checking repository integrity…"
    dc --profile tools run --rm -T restic check --read-data-subset=5%
  fi
elif [[ "$LOCAL_ONLY" == false ]]; then
  log "RESTIC_REPOSITORY not set: offsite backup skipped (local backup only)."
fi

notify ok
log "Backup complete: $NAME"
