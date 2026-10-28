# UniNotes

A private, self-hosted, Markdown-first notes app for university lectures. Organise notes by module and academic year, write with a live preview (maths, code highlighting, Mermaid diagrams), paste screenshots, attach PDFs, find notes by full-text search or on a lecture-date calendar, and import/export plain Markdown with no lock-in.

| | |
|---|---|
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS 4, shadcn-style components on Radix UI, TanStack Query, React Router, CodeMirror 6, react-markdown + GFM + KaTeX + Shiki + Mermaid |
| **Backend** | Node.js 24 LTS, Express 5, TypeScript, SQLite (WAL) + FTS5, Drizzle ORM, Zod, Argon2id, server-side sessions, TOTP MFA |
| **Infrastructure** | Docker Compose: `frontend` + `backend` behind the VPS's host Caddy (`compose.existing-proxy.yaml`, production), or a self-contained stack with its own Caddy (`compose.yaml`); on-demand `restic` container for encrypted offsite backups |

More documentation:

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): **production deployment to the VPS** (architecture, first-deployment checklist, rollback)
- [docs/SECURITY.md](docs/SECURITY.md): the security checklist, threat model, **pre-launch checklist** and penetration-test results
- [docs/API.md](docs/API.md): the REST API guide. The full contract is in [Backend/openapi.json](Backend/openapi.json).
- [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md): architecture, design decisions and data policies

---

## Contents

1. [Repository layout](#repository-layout)
2. [Local development](#local-development)
3. [Testing and quality checks](#testing-and-quality-checks)
4. [Production deployment (VPS)](#production-deployment-vps)
5. [Environment variables](#environment-variables)
6. [Account setup and recovery](#account-setup-and-recovery)
7. [Database migrations](#database-migrations)
8. [Deployment modes](#deployment-modes)
9. [Backups](#backups)
10. [Restoring and disaster recovery](#restoring-and-disaster-recovery)
11. [Updating UniNotes](#updating-uninotes)
12. [Day-to-day operations](#day-to-day-operations)
13. [Troubleshooting](#troubleshooting)

---

## Repository layout

```text
UniNotes/
├── Frontend/            React SPA (independent package.json, Dockerfile, Caddyfile for static serving)
│   ├── src/             pages/, components/, api/ (TanStack Query hooks), hooks/, lib/
│   └── e2e/             Playwright end-to-end tests
├── Backend/             REST API (independent package.json, Dockerfile)
│   ├── src/             routes/, services/, middleware/, db/, lib/
│   ├── drizzle/         SQL migrations (generated + custom FTS5 migration)
│   ├── scripts/         CLI: migrate, create-user, reset-password, backup, restore, openapi
│   ├── test/            Vitest + Supertest API tests
│   └── openapi.json     generated API contract
├── deploy/              Caddyfile.university: site block for the VPS's host Caddy (+ apply/rollback guide)
├── docker/              edge Caddy for the self-contained stack (compose.yaml only)
├── scripts/             deploy, rollback, backup, restore, preflight, healthcheck, compose wrapper,
│                        build-images/ship-images (off-box builds)
├── compose.existing-proxy.yaml   PRODUCTION (VPS): backend + frontend on 127.0.0.1:3002/3003, project "uninotes"
├── compose.yaml         self-contained stack with its own Caddy on 80/443 (NOT for the VPS)
└── .env.example         configuration template (placeholders only)
```

The frontend and backend share no code. They talk only through the documented REST API under `/api`, build separately, and run as separate containers.

---

## Local development

**Prerequisites:** Node.js 24 LTS and npm 11. Docker is only needed for the production stack.

### Backend

```bash
cd Backend
npm install
cp .env.example .env
# Set a real secret: replace APP_SECRET_KEY with the output of `openssl rand -base64 48`
npm run db:migrate              # creates ./data/db/uninotes.db
npm run user:create             # interactive: username, email, password
npm run dev                     # http://localhost:3000 (auto-reload)
```

### Frontend

```bash
cd Frontend
npm install
npm run dev                     # http://localhost:5173
```

The Vite dev server proxies `/api` to `http://localhost:3000`, so the browser sees a single origin (no CORS, and the same cookies as in production). To point at another backend, set `BACKEND_URL=http://host:port` before `npm run dev`. In development, `APP_ORIGIN` in `Backend/.env` must be `http://localhost:5173`.

### Scripts

| Command | Backend | Frontend |
|---|---|---|
| `npm run dev` | API with auto-reload | Vite dev server |
| `npm run build` | compile to `dist/` | production bundle in `dist/` |
| `npm start` | run the compiled API | serve the built bundle (`vite preview`) |
| `npm run lint` | ESLint | ESLint (includes a rule that forbids `dangerouslySetInnerHTML`) |
| `npm run typecheck` | `tsc` (strict) | `tsc -b` (strict) |
| `npm test` | Vitest + Supertest | Vitest + React Testing Library |
| `npm run test:e2e` | (points to Frontend) | Playwright: starts an isolated backend and a production build |
| `npm run format` | Prettier | Prettier |
| `npm run audit` | `npm audit --omit=dev` | `npm audit --omit=dev` |

Backend-only: `db:generate` (create a migration from schema changes), `db:migrate`, `db:status`, `user:create`, `user:reset-password`, `backup`, `openapi` (regenerate `openapi.json`).

---

## Testing and quality checks

```bash
cd Backend  && npm run lint && npm run typecheck && npm test
cd Frontend && npm run lint && npm run typecheck && npm test
cd Frontend && npx playwright install --with-deps chromium && npm run test:e2e
```

- **Backend (91 tests):** authentication, session expiry and revocation, CSRF, rate limiting, MFA (RFC 6238 vectors, replay, recovery codes), every protected route rejecting anonymous access, cross-user isolation, CRUD, revision conflicts, version retention and restore, soft delete, archive, permanent deletion, FTS indexing and query sanitisation, filters, the calendar, uploads (content sniffing, EXIF stripping, polyglots, SVG/HTML/EXE rejection, size limits, path traversal), import/export (ZIP link integrity), migrations, and backup/restore including tamper detection.
- **Frontend (47 tests):** Markdown XSS payloads and URL policy, safe search highlighting, the autosave state machine (debounce, in-flight edits, conflicts, retry), login form and route guards, open-redirect protection, editor formatting commands, filters, calendar interactions, navigation, error states and theme switching.
- **End-to-end (Playwright):** login, create module, create/edit/preview note, paste image, autosave and reload, search, calendar, export, import (with duplicate detection), restore revision, delete and restore, conflicting edits, theme, logout, a CSP-violation check for rich content, and a mobile-viewport test (drawer navigation, editor tabs, no horizontal overflow).

To run the E2E suite against a running deployment (for example, to verify the production CSP):

```bash
E2E_BASE_URL=https://university.wesleyldshub.dev E2E_USER=you E2E_PASSWORD='…' npx playwright test --project=desktop
```

CI (`.github/workflows/ci.yml`) runs formatting, lint, typecheck, unit tests, the build, an OpenAPI drift check, `npm audit`, the E2E suite and both Docker builds.

---

## Production deployment (VPS)

**Full runbook and first-deployment checklist: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).**

UniNotes runs on the same droplet as another application (Notes) behind the **host's systemd Caddy**. It uses `compose.existing-proxy.yaml`:
- Compose project `uninotes`;
- the backend on `127.0.0.1:3002` and the frontend on `127.0.0.1:3003`, loopback only;
- data in bind mounts under `/srv/UniNotes/{data,backups}`.

The host Caddy routes `university.wesleyldshub.dev` to it with [deploy/Caddyfile.university](deploy/Caddyfile.university).

```bash
cd /srv/UniNotes/app
cp .env.example .env && chmod 600 .env    # set UNINOTES_ORIGIN and APP_SECRET_KEY (openssl rand -base64 48)
./scripts/preflight.sh                    # read-only checks: DNS, ports, dirs, .env, compose isolation
./scripts/deploy.sh                       # or --no-build with images built off-box (see the runbook)
./scripts/healthcheck.sh
```

All scripts use `docker compose -f compose.existing-proxy.yaml`. For ad-hoc commands use `./scripts/compose.sh <args>`, **never a bare `docker compose`**: that would pick `compose.yaml`, which starts a second Caddy on 80/443.

### What runs where (VPS)

| Service | Image | Exposed | Notes |
|---|---|---|---|
| `backend` | built from `Backend/`, tag = git short SHA | `127.0.0.1:3002` → 3000 | Express API with embedded SQLite; runs as uid 1000 |
| `frontend` | built from `Frontend/`, tag = git short SHA | `127.0.0.1:3003` → 8080 | static SPA on an unprivileged Caddy, with CSP and security headers |
| `restic` | `restic/restic:0.18.1` | none | runs on demand (`tools` profile) |

**Hardening:**
- multi-stage builds and non-root users;
- read-only root filesystems with tmpfs for scratch space;
- `cap_drop: ALL` and `no-new-privileges`;
- memory and CPU limits (512 MiB / 64 MiB);
- health checks, `restart: unless-stopped` and log rotation (10 MB × 3);
- no Docker socket mounts and no privileged containers.

### Persistent data (VPS)

| Host path | Container path | Contents |
|---|---|---|
| `/srv/UniNotes/data/db` | `/data/db` | SQLite database (`uninotes.db` plus WAL files) |
| `/srv/UniNotes/data/attachments` | `/data/attachments` | uploaded images, PDFs and source files (opaque file names, private) |
| `/srv/UniNotes/backups` | `/data/backups` | verified local snapshots, pre-migration and pre-restore copies |

The data lives outside the git checkout, so re-cloning or `git clean` can never touch it. Container restarts and redeploys never delete it.

---

## Environment variables

Root `.env` (read by Docker Compose; full annotated template in [.env.example](.env.example)):

| Variable | Required | Description |
|---|---|---|
| `UNINOTES_ORIGIN` | ✔ | Public URL: `https://university.wesleyldshub.dev`. Used for CSRF origin checks. |
| `APP_SECRET_KEY` | ✔ | 32+ random characters. Encrypts MFA secrets and keys recovery-code hashes. **Keep a copy in your password manager.** |
| `UNINOTES_COMPOSE_FILE` | | Compose file the scripts drive: `compose.existing-proxy.yaml` (default; the VPS) or `compose.yaml`. |
| `UNINOTES_DATA_DIR` / `UNINOTES_BACKUP_DIR` / `UNINOTES_STATE_DIR` | | Host paths (default `/srv/UniNotes/data`, `/srv/UniNotes/backups`, `/srv/UniNotes`). |
| `UNINOTES_BACKEND_HOST_PORT` / `UNINOTES_FRONTEND_HOST_PORT` | | Loopback ports for the host Caddy (default 3002 / 3003; 3001 belongs to Notes). |
| `UNINOTES_EXPECTED_IP` | | IPv4 address the domain must resolve to (preflight check). |
| `UNINOTES_BACKEND_MEM_LIMIT` / `UNINOTES_FRONTEND_MEM_LIMIT` | | Container memory limits (default 512m / 64m). |
| `COMPOSE_PROJECT_NAME`, `UNINOTES_SITE_ADDRESS`, `UNINOTES_HTTP(S)_BIND/PORT`, `UNINOTES_TRUSTED_PROXIES` | | **`compose.yaml` only** (self-contained stack with its own Caddy). Unused on the VPS. |
| `UNINOTES_COOKIE_SECURE` | | `true` (default). Only set `false` for plain-HTTP testing on a non-localhost host. |
| `SESSION_IDLE_DAYS` / `SESSION_ABSOLUTE_DAYS` | | Session lifetimes (default 7 / 30). |
| `MAX_IMAGE_MB` / `MAX_ATTACHMENT_MB` / `MAX_IMPORT_MB` | | Upload limits (default 10 / 25 / 2). |
| `VERSION_RETENTION` | | Versions kept per note (default 100). |
| `RECYCLE_BIN_RETENTION_DAYS` | | Auto-purge deleted notes after N days (default 0 = never). |
| `LOG_LEVEL` | | `info` by default. |
| `LOCAL_BACKUP_KEEP` | | Local snapshots to keep (default 14 on the VPS). |
| `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`, `AWS_*`, `B2_*` | | Offsite backup target and credentials. |
| `RESTIC_KEEP_DAILY` / `_WEEKLY` / `_MONTHLY` | | Offsite retention (default 30 / 8 / 6). |
| `BACKUP_NOTIFY_URL` | | Pinged on backup success; `<url>/fail` is pinged on failure. |

`Backend/.env` (development only) uses the backend's own names: `APP_ORIGIN`, `APP_SECRET_KEY`, `DATA_DIR`, `PORT`, `COOKIE_SECURE`, `LOG_LEVEL`, and also `MIGRATE_ON_START`, `VERSION_INTERVAL_MINUTES` and `TRUST_PROXY`. All are validated at startup by `Backend/src/config.ts`.

---

## Account setup and recovery

There is no public sign-up page and no password-reset endpoint. Accounts are managed only from the server shell.

```bash
# Create the account (safe to re-run: it never modifies an existing account)
./scripts/compose.sh run --rm -it backend node dist/scripts/create-user.js

# Non-interactive alternative
printf '%s' "$PASSWORD" | ./scripts/compose.sh run --rm -T backend node dist/scripts/create-user.js \
  --username alice --email alice@example.com --display-name "Alice" --password-stdin

# Forgotten password: sets a new password and signs out every session
./scripts/compose.sh run --rm -it backend node dist/scripts/reset-password.js --username alice

# Lost authenticator and no recovery codes: also disables MFA
./scripts/compose.sh run --rm -it backend node dist/scripts/reset-password.js --username alice --disable-mfa
```

Passwords must be at least 12 characters and must not contain the username.

---

## Database migrations

Migrations live in `Backend/drizzle/` and **never run automatically** when a container starts. If the backend detects pending migrations it refuses to start and logs the command to run.

```bash
# Check status
./scripts/compose.sh run --rm backend node dist/scripts/migrate.js --status

# Apply (deploy.sh does this for you, after a backup)
./scripts/compose.sh run --rm backend node dist/scripts/migrate.js
```

`migrate.js` also takes its own pre-migration snapshot in `/data/backups/pre-migration/` and runs an integrity check afterwards.

**Which changes need a migration?** Any change to `Backend/src/db/schema.ts`, or to FTS/virtual tables. Generate one with `npm run db:generate` (or `npx drizzle-kit generate --custom` for hand-written SQL), review the SQL, and commit it. Frontend-only changes and backend code changes that leave the schema alone need no migration.

---

## Deployment modes

| Mode | Compose file | When |
|---|---|---|
| **Host reverse proxy** (production) | `compose.existing-proxy.yaml` | The VPS: the systemd Caddy owns 80/443 and also serves Notes. UniNotes publishes only `127.0.0.1:3002/3003`; add [deploy/Caddyfile.university](deploy/Caddyfile.university) to the host Caddy. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). |
| Self-contained | `compose.yaml` | A server where nothing else uses 80/443 (or local testing). Its own Caddy obtains certificates automatically; set `UNINOTES_COMPOSE_FILE=compose.yaml`, `UNINOTES_SITE_ADDRESS=<domain>` and `COMPOSE_PROJECT_NAME`. **Never on the VPS.** |

**Client IPs.** The backend trusts exactly one proxy hop (`TRUST_PROXY=1`). The host Caddy block replaces `X-Forwarded-For` with the real client IP (`header_up X-Forwarded-For {client_ip}`), so visitors cannot forge their address to get around the per-IP login limits.

---

## Backups

`scripts/backup.sh` does the following:

1. Takes a **consistent SQLite snapshot** with SQLite's online backup API (safe while the app is running; the live database file is never simply copied). It also drops session rows, which are short-lived credentials.
2. Copies the referenced attachments and writes `manifest.json` with SHA-256 checksums and counts.
3. **Verifies** the snapshot: checksums, `PRAGMA integrity_check`, foreign keys, and that every attachment is present and matches. Only verified backups are kept.
4. Prunes local snapshots to `LOCAL_BACKUP_KEEP`.
5. If `RESTIC_REPOSITORY` is set, uploads the snapshot **encrypted** with restic (initialising the repository on first run) and applies retention: **30 daily, 8 weekly, 6 monthly**. `--check` also verifies a 5% sample of the repository data.
6. Logs to stderr and exits non-zero on failure. It also pings `BACKUP_NOTIFY_URL` (or `<url>/fail`), which works with healthchecks.io, Uptime Kuma push monitors and similar.

```bash
./scripts/backup.sh              # local + offsite
./scripts/backup.sh --local      # local only
./scripts/backup.sh --check      # local + offsite + repository integrity check
```

Schedule it with cron as `wesley` (who is in the `docker` group; no sudo needed):

```cron
17 3 * * *  /srv/UniNotes/app/scripts/backup.sh >> /srv/UniNotes/backups/backup.log 2>&1
47 3 * * 0  /srv/UniNotes/app/scripts/backup.sh --check >> /srv/UniNotes/backups/backup.log 2>&1
```

Backups contain the hashed password, hashed recovery codes and the **encrypted** MFA secret. They contain no plaintext credentials. The `.env` file (which holds `APP_SECRET_KEY` and `RESTIC_PASSWORD`) is deliberately **not** included. Store those two values in a password manager: without `RESTIC_PASSWORD` the offsite backups cannot be decrypted.

---

## Restoring and disaster recovery

```bash
./scripts/restore.sh --list                         # local backups and offsite snapshots
./scripts/restore.sh latest --verify-only           # check a backup without changing anything
./scripts/restore.sh 2026-10-17T03-15-00-000Z       # restore a local backup
./scripts/restore.sh restic:latest                  # restore from the offsite repository
```

The restore process first verifies the backup, then stops the backend and preserves the current data in `/data/backups/pre-restore-<time>/` (so a restore can itself be undone). It then replaces the database and attachments, rebuilds the search index, applies any pending migrations, and restarts and health-checks the backend. Users must sign in again afterwards.

### Restoring onto a brand-new VPS

1. Install Docker and the Compose plugin, clone this repository to `/srv/UniNotes/app`, and create the data and backup directories ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) §4C).
2. Recreate `.env` from your password manager with the **same `APP_SECRET_KEY`** and the same `RESTIC_*` settings. A different key still restores every note, but MFA then has to be reset with `reset-password.js --disable-mfa`.
3. `./scripts/deploy.sh` (starts an empty instance).
4. `./scripts/restore.sh restic:latest --yes`
5. Point DNS at the new server, add the Caddy site block, and sign in.

This exact procedure was rehearsed during development. A Docker stack's volumes were deleted, the stack was redeployed empty, then restored from restic. Note count, attachments, sign-in, full-text search and image serving were all confirmed afterwards.

---

## Updating UniNotes

```bash
cd /srv/UniNotes/app
./scripts/deploy.sh --ref <tag-or-commit>             # build on the VPS (needs swap), or:
./scripts/deploy.sh --ref <tag-or-commit> --no-build  # with images shipped from Codespaces
./scripts/rollback.sh                                 # back to the previous release
```

`deploy.sh` runs preflight, takes a backup before migrating, starts the new release, and health-checks it. If the release is unhealthy, it returns to the previous release automatically. During a backend restart the host Caddy retries API requests for up to 15 seconds. Open browser tabs pick up a new frontend on their next navigation; any unsaved editor content is retried by autosave.

---

## Day-to-day operations

```bash
./scripts/healthcheck.sh                        # containers, local endpoints and the public URL
./scripts/compose.sh ps
./scripts/compose.sh logs -f --tail 100 backend
./scripts/compose.sh logs -f frontend
./scripts/compose.sh restart backend
./scripts/compose.sh stop                       # stops containers; data on disk is kept
```

Backend logs are structured JSON (pino). Passwords, cookies, CSRF tokens, codes and secrets are redacted.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Backend exits with "pending migrations" | Run `./scripts/deploy.sh backend`, or the migrate command shown in the log. |
| `required variable … is missing` from Compose | Fill in `UNINOTES_ORIGIN` and `APP_SECRET_KEY` in `.env`. |
| Sign-in works but every save returns 403 `CSRF_ORIGIN_MISMATCH` | `UNINOTES_ORIGIN` must exactly match the URL in the browser (scheme, host, port). |
| Sign-in appears to succeed but you are immediately logged out | You are on plain HTTP over a non-localhost host while `UNINOTES_COOKIE_SECURE=true`. Use HTTPS. |
| Caddy cannot obtain a certificate | Check that the `university` A record resolves to the droplet (no AAAA), then `sudo journalctl -u caddy --since -10m`. |
| `bind: address already in use` on 80/443 | You started `compose.yaml` on the VPS. Stop it, and use the scripts (which use `compose.existing-proxy.yaml`). |
| 502 from `university.wesleyldshub.dev` | The containers are down or unhealthy: `./scripts/healthcheck.sh --local`, then `./scripts/compose.sh logs backend`. |
| "Too many attempts" at sign-in | Wait 15 minutes. Limits are per IP and per account. |
| Lost authenticator | Use a recovery code, or run `reset-password.js --disable-mfa` on the server. |
| Upload rejected | Allowed: PNG, JPEG, WebP, PDF, and source code (`.c .h .py .js .ts .html`, UTF-8 text, max 1 MB), within the size limits. The type is checked from the file's contents. Files over 30 MB are rejected by Caddy (413). |
| A page shows "UniNotes was updated" | A new frontend was deployed while the tab was open. Reload. |
| Containers cannot reach each other (`no upstreams available`, dial timeouts) | Usually a host firewall with `FORWARD DROP` blocking Docker bridges, which Docker normally manages. Check `iptables -S FORWARD` and any legacy tables (`iptables-legacy -S FORWARD`). |
| Check health | `curl -s https://university.wesleyldshub.dev/api/health` returns `{"data":{"status":"ok","database":"ok"}}` |
