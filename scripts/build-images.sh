#!/usr/bin/env bash
# Build the UniNotes release images for the current commit, one at a time, WITHOUT starting
# anything. Intended for a machine with spare memory (Codespaces, CI, a laptop): the frontend
# build peaks at ~1.1 GiB, too close to the limit on the 1.9 GiB VPS without swap.
#
#   ./scripts/build-images.sh            -> uninotes-backend:<sha> and uninotes-frontend:<sha>
#   then: ./scripts/ship-images.sh wesley@<vps>     and on the VPS: ./scripts/deploy.sh --no-build
#
# Needs no .env and no access to the VPS.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || {
  echo "WARNING: uncommitted changes are included in the images but not in the tag $(git rev-parse --short=12 HEAD)." >&2
}
TAG="$(git rev-parse --short=12 HEAD)"
[[ "$(uname -m)" == x86_64 ]] || echo "WARNING: building on $(uname -m); the VPS is x86_64 (use: docker buildx build --platform linux/amd64)." >&2
docker build -t "uninotes-backend:$TAG" Backend
docker build -t "uninotes-frontend:$TAG" Frontend
echo "Built uninotes-backend:$TAG and uninotes-frontend:$TAG"
