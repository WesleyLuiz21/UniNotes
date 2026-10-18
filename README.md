# UniNotes

A private, self-hosted, Markdown-first notes app for university lectures. Organise notes by module and academic year, write with a live preview (maths, code highlighting, Mermaid diagrams), paste screenshots, attach PDFs, find notes by full-text search or on a lecture-date calendar, and import/export plain Markdown with no lock-in.

| | |
|---|---|
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS 4, shadcn-style components on Radix UI, TanStack Query, React Router, CodeMirror 6, react-markdown + GFM + KaTeX + Shiki + Mermaid |
| **Backend** | Node.js 24 LTS, Express 5, TypeScript, SQLite (WAL) + FTS5, Drizzle ORM, Zod, Argon2id, server-side sessions, TOTP MFA |
| **Infrastructure** | Docker Compose: `frontend`, `backend`, `caddy` (HTTPS reverse proxy), plus an on-demand `restic` container for encrypted offsite backups |

More documentation:

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
8. [Reverse proxy options](#reverse-proxy-options)
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
├── docker/Caddyfile     edge reverse proxy (HTTPS, routing /api → backend, / → frontend)
├── scripts/             deploy.sh, backup.sh, restore.sh (host-side operations)
├── compose.yaml         production stack
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
E2E_BASE_URL=https://notes.example.com E2E_USER=you E2E_PASSWORD='…' npx playwright test --project=desktop
```

CI (`.github/workflows/ci.yml`) runs formatting, lint, typecheck, unit tests, the build, an OpenAPI drift check, `npm audit`, the E2E suite and both Docker builds.

---

## Production deployment (VPS)

**Requirements:** a Linux VPS with Docker Engine 24+ and the Compose plugin, and about 1 GB RAM. For automatic HTTPS you also need a domain whose DNS points at the server.

```bash
# 1. Get the code
git clone <your-repo-url> UniNotes && cd UniNotes

# 2. Configure
cp .env.example .env && chmod 600 .env
openssl rand -base64 48        # paste the output as APP_SECRET_KEY in .env
nano .env                      # set UNINOTES_ORIGIN, UNINOTES_SITE_ADDRESS, proxy mode, backups

# 3. Build, migrate and start
./scripts/deploy.sh

# 4. Create your account (prompts for username, email and password)
docker compose run --rm -it backend node dist/scripts/create-user.js

# 5. Open UNINOTES_ORIGIN in a browser and sign in.
#    Then enable two-factor authentication: Settings → Security.

# 6. Schedule backups (see "Backups")
```

`deploy.sh` validates `.env`, builds the images, takes a verified backup if a database already exists, applies migrations explicitly, starts the stack, and waits for health checks.

### What runs where

| Service | Image | Exposed | Notes |
|---|---|---|---|
| `caddy` | built from `docker/caddy/` (Caddy 2.11.7, patched Go) | 80/443 (configurable bind address and ports) | TLS, HSTS, routes `/api/*` → backend and everything else → frontend |
| `frontend` | built from `Frontend/` | internal network only | static SPA on an unprivileged Caddy (port 8080), with CSP and security headers |
| `backend` | built from `Backend/` | internal network only | Express API with embedded SQLite (no separate DB container) |
| `restic` | `restic/restic:0.18.1` | none | runs on demand (`tools` profile) |

Hardening: multi-stage builds, non-root users, read-only root filesystems with tmpfs for scratch space, `cap_drop: ALL` (the edge Caddy keeps only `NET_BIND_SERVICE`), `no-new-privileges`, memory/CPU limits, health checks, `restart: unless-stopped`, log rotation, and no Docker socket mounts or privileged containers. The backend and frontend sit on an `internal: true` network with no route to the internet.

### Persistent data

All state lives in named volumes prefixed with `COMPOSE_PROJECT_NAME` (default `uninotes`):

| Volume | Contents |
|---|---|
| `uninotes_db` | SQLite database (`/data/db/uninotes.db` plus WAL files) |
| `uninotes_attachments` | uploaded images and PDFs (opaque filenames) |
| `uninotes_backups` | verified local backup snapshots, pre-migration and pre-restore copies |
| `uninotes_caddy_data` | TLS certificates and ACME account |

`docker compose down`, `restart` and `up --build` never delete volumes. **Do not run `docker compose down -v`** unless you intend to destroy all data.

---

## Environment variables

Root `.env` (read by Docker Compose; full annotated template in [.env.example](.env.example)):

| Variable | Required | Description |
|---|---|---|
| `COMPOSE_PROJECT_NAME` | | Prefix for containers, volumes and networks (default `uninotes`). Change it to avoid clashes with other stacks. |
| `UNINOTES_ORIGIN` | ✔ | Public URL, e.g. `https://notes.example.com`. Used for CSRF origin checks. |
| `APP_SECRET_KEY` | ✔ | 32+ random characters. Encrypts MFA secrets and keys recovery-code hashes. **Keep a copy in your password manager.** |
| `UNINOTES_SITE_ADDRESS` | | Caddy site address: a domain (automatic HTTPS) or `:80` (behind another proxy). |
| `UNINOTES_HTTP_BIND` / `UNINOTES_HTTP_PORT` | | Host bind address and port for HTTP (default `0.0.0.0:80`). |
| `UNINOTES_HTTPS_BIND` / `UNINOTES_HTTPS_PORT` | | Host bind address and port for HTTPS (default `0.0.0.0:443`). |
| `UNINOTES_TRUSTED_PROXIES` | | CIDRs whose `X-Forwarded-For` Caddy believes. Default `127.0.0.1/32` = nobody (correct when Caddy faces the internet). Widen only behind an existing proxy (Option B). |
| `UNINOTES_COOKIE_SECURE` | | `true` (default). Only set `false` for plain-HTTP testing on a non-localhost host. |
| `SESSION_IDLE_DAYS` / `SESSION_ABSOLUTE_DAYS` | | Session lifetimes (default 7 / 30). |
| `MAX_IMAGE_MB` / `MAX_ATTACHMENT_MB` / `MAX_IMPORT_MB` | | Upload limits (default 10 / 25 / 2). |
| `VERSION_RETENTION` | | Versions kept per note (default 100). |
| `RECYCLE_BIN_RETENTION_DAYS` | | Auto-purge deleted notes after N days (default 0 = never). |
| `LOG_LEVEL` | | `info` by default. |
| `LOCAL_BACKUP_KEEP` | | Local snapshots to keep (default 7). |
| `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`, `AWS_*`, `B2_*` | | Offsite backup target and credentials. |
| `RESTIC_KEEP_DAILY` / `_WEEKLY` / `_MONTHLY` | | Offsite retention (default 30 / 8 / 6). |
| `BACKUP_NOTIFY_URL` | | Pinged on backup success; `<url>/fail` is pinged on failure. |

`Backend/.env` (development only) uses the backend's own names: `APP_ORIGIN`, `APP_SECRET_KEY`, `DATA_DIR`, `PORT`, `COOKIE_SECURE`, `LOG_LEVEL`, and also `MIGRATE_ON_START`, `VERSION_INTERVAL_MINUTES` and `TRUST_PROXY`. All are validated at startup by `Backend/src/config.ts`.

---

## Account setup and recovery

There is no public sign-up page and no password-reset endpoint. Accounts are managed only from the server shell.

```bash
# Create the account (safe to re-run: it never modifies an existing account)
docker compose run --rm -it backend node dist/scripts/create-user.js

# Non-interactive alternative
printf '%s' "$PASSWORD" | docker compose run --rm -T backend node dist/scripts/create-user.js \
  --username alice --email alice@example.com --display-name "Alice" --password-stdin

# Forgotten password: sets a new password and signs out every session
docker compose run --rm -it backend node dist/scripts/reset-password.js --username alice

# Lost authenticator and no recovery codes: also disables MFA
docker compose run --rm -it backend node dist/scripts/reset-password.js --username alice --disable-mfa
```

Passwords must be at least 12 characters and must not contain the username.

---

## Database migrations

Migrations live in `Backend/drizzle/` and **never run automatically** when a container starts. If the backend detects pending migrations it refuses to start and logs the command to run.

```bash
# Check status
docker compose run --rm backend node dist/scripts/migrate.js --status

# Apply (deploy.sh does this for you, after a backup)
docker compose run --rm backend node dist/scripts/migrate.js
```

`migrate.js` also takes its own pre-migration snapshot in `/data/backups/pre-migration/` and runs an integrity check afterwards.

**Which changes need a migration?** Any change to `Backend/src/db/schema.ts`, or to FTS/virtual tables. Generate one with `npm run db:generate` (or `npx drizzle-kit generate --custom` for hand-written SQL), review the SQL, and commit it. Frontend-only changes and backend code changes that leave the schema alone need no migration.

---

## Reverse proxy options

### Option A: bundled Caddy with automatic HTTPS (default)

Requires ports 80 and 443 to be free and DNS pointing at the VPS.

```dotenv
UNINOTES_ORIGIN=https://notes.example.com
UNINOTES_SITE_ADDRESS=notes.example.com
```

### Option B: an existing reverse proxy already owns 80/443

UniNotes' Caddy listens on loopback only, in plain HTTP. Your existing proxy terminates TLS and forwards everything (both `/` and `/api`, unchanged) to it.

```dotenv
UNINOTES_ORIGIN=https://notes.example.com
UNINOTES_SITE_ADDRESS=:80
UNINOTES_HTTP_BIND=127.0.0.1
UNINOTES_HTTP_PORT=8088
UNINOTES_HTTPS_BIND=127.0.0.1
UNINOTES_HTTPS_PORT=8443
UNINOTES_TRUSTED_PROXIES=172.16.0.0/12
```

nginx example:

```nginx
server {
    listen 443 ssl http2;
    server_name notes.example.com;
    # ssl_certificate … (your existing TLS setup)
    client_max_body_size 40m;
    location / {
        proxy_pass http://127.0.0.1:8088;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

Existing Caddy: `notes.example.com { reverse_proxy 127.0.0.1:8088 }`. With Traefik, route the host to `http://127.0.0.1:8088` with a file-provider service.

The UniNotes containers use project-prefixed names and their own networks, so they won't collide with other stacks. Nothing in this repository modifies existing proxy or Docker configuration.

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

Schedule it with cron as the user that runs Docker:

```cron
15 3 * * *  /opt/UniNotes/scripts/backup.sh >> /var/log/uninotes-backup.log 2>&1
45 3 * * 0  /opt/UniNotes/scripts/backup.sh --check >> /var/log/uninotes-backup.log 2>&1
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

1. Install Docker and the Compose plugin, then clone this repository.
2. Recreate `.env` from your password manager with the **same `APP_SECRET_KEY`** and the same `RESTIC_*` settings. A different key still restores every note, but MFA then has to be reset with `reset-password.js --disable-mfa`.
3. `./scripts/deploy.sh` (starts an empty instance).
4. `./scripts/restore.sh restic:latest --yes`
5. Point DNS at the new server and sign in.

This exact procedure was rehearsed during development. A Docker stack's volumes were deleted, the stack was redeployed empty, then restored from restic. Note count, attachments, sign-in, full-text search and image serving were all confirmed afterwards.

---

## Updating UniNotes

```bash
cd /opt/UniNotes
git pull
./scripts/deploy.sh             # everything: backup → migrate → restart
./scripts/deploy.sh frontend    # UI-only changes: no database impact
./scripts/deploy.sh backend     # API changes: backup → migrate → restart backend
```

During a backend restart, the edge proxy retries requests for up to 15 seconds. Open browser tabs pick up a new frontend build on their next navigation; any unsaved editor content is retried by autosave.

---

## Day-to-day operations

```bash
docker compose up -d --build              # build and start everything
docker compose up -d --build frontend     # rebuild one service
docker compose up -d --build backend      # (run migrations first if the schema changed)
docker compose restart frontend
docker compose restart backend
docker compose logs -f frontend
docker compose logs -f backend
docker compose ps
docker compose down                       # stops containers; data volumes are kept
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
| Caddy cannot obtain a certificate | Check DNS, make sure ports 80/443 are reachable, then `docker compose logs caddy`. Behind another proxy, use Option B. |
| `bind: address already in use` on 80/443 | Another service owns those ports. Use Option B, or change `UNINOTES_HTTP(S)_PORT`. |
| "Too many attempts" at sign-in | Wait 15 minutes. Limits are per IP and per account. Behind a proxy, set `UNINOTES_TRUSTED_PROXIES` so client IPs are seen correctly. |
| Lost authenticator | Use a recovery code, or run `reset-password.js --disable-mfa` on the server. |
| Upload rejected | Only PNG, JPEG, WebP and PDF are allowed, within the size limits. The file type is checked from the file's contents, not its name. |
| A page shows "UniNotes was updated" | A new frontend was deployed while the tab was open. Reload. |
| Containers cannot reach each other (`no upstreams available`, dial timeouts) | Usually a host firewall with `FORWARD DROP` blocking Docker bridges, which Docker normally manages. Check `iptables -S FORWARD` and any legacy tables (`iptables-legacy -S FORWARD`). |
| Check health | `curl -s https://notes.example.com/api/health` returns `{"data":{"status":"ok","database":"ok"}}` |
