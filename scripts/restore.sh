#!/usr/bin/env bash
# Restore UniNotes from a backup. The current data is preserved first (pre-restore-<time>).
#
#   ./scripts/restore.sh --list                      list local and offsite backups
#   ./scripts/restore.sh <local-backup-name>         e.g. 2026-10-17T03-15-00-000Z
#   ./scripts/restore.sh latest                      newest local backup
#   ./scripts/restore.sh restic:<snapshot-id|latest> restore from the offsite repository (fresh VPS)
#   add --verify-only to check a backup without changing anything
#   add --yes to skip the confirmation prompt
source "$(dirname "$0")/_common.sh"

TARGET=""; VERIFY_ONLY=false; YES=false; LIST=false
for a in "$@"; do
  case "$a" in
    --verify-only) VERIFY_ONLY=true ;;
    --yes) YES=true ;;
    --list) LIST=true ;;
    -*) die "Unknown option: $a" ;;
    *) TARGET="$a" ;;
  esac
done

in_backend() { dc run --rm --no-deps -T backend "$@"; }

if [[ "$LIST" == true ]]; then
  log "Local backups:"
  in_backend sh -c 'ls -1 /data/backups/local 2>/dev/null | grep -v partial || true'
  if [[ -n "$(env_get RESTIC_REPOSITORY || true)" ]]; then
    log "Offsite snapshots:"
    dc --profile tools run --rm -T restic snapshots --tag uninotes
  fi
  exit 0
fi
[[ -n "$TARGET" ]] || die "Specify a backup (see --list)"

if [[ "$TARGET" == restic:* ]]; then
  SNAP="${TARGET#restic:}"
  STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  log "Restoring snapshot '$SNAP' from restic into the backups volume…"
  dc --profile tools run --rm -T restic restore "$SNAP" --tag uninotes --target "/backups/restored-$STAMP"
  # restic runs as root; hand the files to the backend's unprivileged user (uid 1000).
  dc --profile tools run --rm -T --entrypoint chown restic -R 1000:1000 "/backups/restored-$STAMP"
  DIR="$(in_backend sh -c "find /data/backups/restored-$STAMP -name manifest.json -printf '%h\n' | head -n1")"
elif [[ "$TARGET" == latest ]]; then
  DIR="$(in_backend sh -c 'ls -1d /data/backups/local/*/ 2>/dev/null | grep -v partial | sort | tail -n1')"
  DIR="${DIR%/}"
else
  [[ "$TARGET" =~ ^[A-Za-z0-9._:-]+$ ]] || die "Invalid backup name"
  DIR="/data/backups/local/$TARGET"
fi
DIR="$(printf '%s' "$DIR" | tr -d '\r')"
[[ -n "$DIR" ]] || die "Backup not found"

log "Verifying $DIR…"
in_backend node dist/scripts/backup.js --verify "$DIR"
[[ "$VERIFY_ONLY" == true ]] && { log "Verification only: nothing changed."; exit 0; }

if [[ "$YES" != true ]]; then
  read -r -p "This replaces the current notes and attachments with the backup. Continue? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || die "Aborted"
fi

log "Stopping backend…"
dc stop backend
log "Restoring…"
in_backend node dist/scripts/restore.js "$DIR" --yes
log "Applying any pending migrations…"
in_backend node dist/scripts/migrate.js
log "Starting backend…"
dc up -d backend
wait_healthy backend
log "Restore complete. Users must sign in again (sessions are not included in backups)."
