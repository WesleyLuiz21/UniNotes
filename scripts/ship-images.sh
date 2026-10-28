#!/usr/bin/env bash
# Copy the release images for the current commit to the VPS over SSH (docker save | docker load).
# Run from Codespaces/CI after scripts/build-images.sh. It only LOADS images on the VPS: it does
# not start, stop or change anything there. Deploy afterwards on the VPS with:
#   cd /srv/UniNotes/app && git fetch && git checkout <same commit> && ./scripts/deploy.sh --no-build
#
#   ./scripts/ship-images.sh wesley@178.62.99.141 [ssh options…]
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET="${1:?Usage: ship-images.sh <user@host> [ssh options]}"; shift
TAG="$(git rev-parse --short=12 HEAD)"
for img in "uninotes-backend:$TAG" "uninotes-frontend:$TAG"; do
  docker image inspect "$img" >/dev/null 2>&1 || { echo "Missing $img: run scripts/build-images.sh first" >&2; exit 1; }
done
echo "Sending uninotes-backend:$TAG and uninotes-frontend:$TAG to $TARGET…"
docker save "uninotes-backend:$TAG" "uninotes-frontend:$TAG" | gzip -1 | ssh "$@" "$TARGET" 'gunzip | docker load'
echo "Done. On the VPS: ./scripts/deploy.sh --no-build (with the checkout at $TAG)"
