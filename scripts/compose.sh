#!/usr/bin/env bash
# Safe wrapper for ad-hoc docker compose commands on the VPS: always the UniNotes compose file,
# project "uninotes" and the currently deployed image tag. Examples:
#   ./scripts/compose.sh ps
#   ./scripts/compose.sh logs -f --tail 100 backend
#   ./scripts/compose.sh run --rm -it backend node dist/scripts/create-user.js
#   ./scripts/compose.sh run --rm -it backend node dist/scripts/reset-password.js
# Refuses commands that remove things in bulk (use the dedicated scripts instead).
source "$(dirname "$0")/_common.sh"

for a in "$@"; do
  case "$a" in
    -v | --volumes | --remove-orphans | --rmi) die "Refusing '$a' here. Remove things deliberately with plain docker commands." ;;
  esac
done
dc "$@"
