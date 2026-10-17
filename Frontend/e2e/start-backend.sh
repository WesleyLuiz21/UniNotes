#!/usr/bin/env bash
# Starts an isolated backend for end-to-end tests with a fresh database and a known test account.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$HERE/../../Backend"
export DATA_DIR="$HERE/.data"
export NODE_ENV=test
export PORT="${E2E_BACKEND_PORT:-3100}"
export APP_ORIGIN="http://localhost:${E2E_FRONTEND_PORT:-4173}"
export APP_SECRET_KEY="e2e-only-secret-key-not-for-production-use-0123456789"
export COOKIE_SECURE=false
export LOG_LEVEL=warn
export LOGIN_RATE_LIMIT=200
export VERSION_INTERVAL_MINUTES=0
rm -rf "$DATA_DIR"
cd "$BACKEND"
npx tsx scripts/migrate.ts >/dev/null
printf '%s' 'e2e password long enough' | npx tsx scripts/create-user.ts --username tester --email tester@example.com --display-name "E2E Student" --password-stdin >/dev/null
exec npx tsx src/server.ts
