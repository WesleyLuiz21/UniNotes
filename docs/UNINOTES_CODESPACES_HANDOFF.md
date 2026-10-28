# UniNotes — Codespaces Handoff (for Claude Code)

**Audience:** Claude Code running in the UniNotes GitHub Codespace.
**Goal:** prepare the repository so it deploys cleanly to the existing VPS behind the **host-installed Caddy**, without touching the separate Notes app already running there.
**Source facts:** `UNINOTES_VPS_DISCOVERY.md` and `UNINOTES_DEPLOYMENT_ALIGNMENT.md` (produced on the VPS, 2026-10-28).

> **Important:** the VPS audit did **not** see the UniNotes repository. All statements about current repo contents are **assumptions** (⚠️). Inspect the repo first, then make it conform to the requirements below. Where the repo already satisfies a requirement, leave it alone and say so.

---

## 0. Verified VPS constraints you must design for

| Constraint | Value |
|---|---|
| Reverse proxy | **Caddy v2.11.1 on the host (systemd), not in Docker.** It reaches apps only via `127.0.0.1:<port>`. |
| Shared Docker network | **None.** Do not reference `caddy_net`, `app_default` or any `external: true` network. |
| Ports already in use (loopback) | 2019 (Caddy admin), 3001 (Notes API), 38559 (unknown) |
| Ports for UniNotes | backend **3002**, frontend **3003** (host side, `127.0.0.1` only) |
| Reserved names: never use | Compose project `app`; container `notes-api`; network `app_default`; host port 3001 |
| Docker / Compose | Engine 29.1.3, Compose plugin v5.1.0 (`docker compose`, no hyphen). Omit the obsolete `version:` key. |
| Host user | `wesley` uid/gid **1000**, in `docker` group |
| RAM / swap | 1 vCPU, 1.9 GiB, **no swap**. Builds must be lean. |
| Host tools | `git` yes; `sqlite3` **no**; `gh` **no** |
| Host paths | repo at `/srv/UniNotes/app`, data at `/srv/UniNotes/data/{db,attachments}`, backups at `/srv/UniNotes/backups` |
| Public URL | `https://university.wesleyldshub.dev` (IPv4 only) |
| Firewall | ufw active, but **Docker-published ports bypass ufw**, so loopback binding is mandatory |

---

## 1. Step 1: inspect and report before changing anything

Read and summarise:
- `compose.yaml`, `compose.existing-proxy.yaml`
- `docker/` (Dockerfiles, nginx/Caddy configs)
- `Backend/package.json`, the entrypoint, route mounting (is everything under `/api`?), DB init/migrations, upload handling, session/cookie config, CORS, `trust proxy`, health route
- `Frontend/package.json`, `vite.config.*`, how the API base URL is resolved
- `scripts/`
- `.env.example`, `.gitignore`, `.dockerignore`

Produce a gap list against §2–§10 before editing.

---

## 2. `compose.existing-proxy.yaml`: required properties

Mandatory (each is a hard requirement):

1. **`name: uninotes`** at top level. Prevents collision with Notes' implicit `app` project, whose `--remove-orphans` could otherwise delete `notes-api`.
2. Services `backend` and `frontend` with `container_name: uninotes-backend` / `uninotes-frontend`.
3. **No `caddy`/proxy service. No external networks.** Use the default project network only.
4. Ports published **only** on loopback, configurable:
   - `"127.0.0.1:${UNINOTES_BACKEND_HOST_PORT:-3002}:<backend internal port>"`
   - `"127.0.0.1:${UNINOTES_FRONTEND_HOST_PORT:-3003}:<frontend internal port>"`
5. Bind mounts with an overridable root:
   - `${UNINOTES_DATA_DIR:-/srv/UniNotes/data}/db:/app/data/db`
   - `${UNINOTES_DATA_DIR:-/srv/UniNotes/data}/attachments:/app/data/attachments`
   - Mount **directories**, not the `.db` file (WAL/SHM must sit beside it).
6. `image: uninotes-backend:${UNINOTES_TAG:-latest}` / `uninotes-frontend:${UNINOTES_TAG:-latest}` alongside `build:`, so releases are tag-addressable for rollback.
7. `restart: unless-stopped` on both.
8. `healthcheck` on both (backend hits the health route; frontend hits `/`). Frontend `depends_on: backend: condition: service_healthy`.
9. Backend `user: "1000:1000"`; `security_opt: [no-new-privileges:true]`; `read_only: true` + `tmpfs: [/tmp]` if the app doesn't write outside `/app/data`.
10. `mem_limit`: backend `384m`, frontend `64m`.
11. Logging: `json-file`, `max-size: 10m`, `max-file: "3"` (the VPS has no global log rotation).
12. `env_file: ./.env` for the backend only. The frontend gets no runtime secrets.

`compose.yaml` (dev/self-contained) may keep its own proxy, but **must not** be used on the VPS. State this in a comment at the top of both files.

A reference shape is in `UNINOTES_DEPLOYMENT_ALIGNMENT.md` §4.

---

## 3. Backend requirements (`Backend/`)

| # | Requirement |
|---|---|
| B1 | Listen on `process.env.PORT` (default 3002 in this compose), host `0.0.0.0` inside the container. |
| B2 | **All routes mounted under `/api`** (Caddy uses `handle /api/*`, which does **not** strip the prefix). If routes are currently unprefixed, add an `/api` router mount. Don't rely on proxy stripping. |
| B3 | `GET /api/health` → `200 {"status":"ok"}` with a trivial DB check (`SELECT 1`). No auth, no internal details. |
| B4 | `app.set('trust proxy', 1)` when `TRUST_PROXY=1` / production, so secure cookies and `req.ip` work behind Caddy. |
| B5 | Session cookies: `secure: true` (prod), `httpOnly: true`, `sameSite: 'lax'`. Secret from env; refuse to start in production if missing or shorter than 32 chars. |
| B6 | CORS: same-origin in prod. If CORS middleware remains, allow only `process.env.APP_ORIGIN` (`https://university.wesleyldshub.dev`). |
| B7 | DB path from `DB_PATH` (default `/app/data/db/uninotes.db`). Create the parent dir if missing. Enable `PRAGMA journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`. |
| B8 | Schema migrations: idempotent, versioned (e.g. `user_version`), run at startup **after** the DB opens. Log the version transition. |
| B9 | Attachments under `ATTACHMENTS_DIR` (default `/app/data/attachments`): server-generated random filenames (no user-supplied paths); store original name/MIME in the DB; reject path traversal. |
| B10 | Attachment download only via an **authenticated, ownership-checked** route. Send `Content-Disposition` (`attachment` for non-image types), the correct `Content-Type`, and `X-Content-Type-Options: nosniff`. Never expose the directory statically. |
| B11 | Upload limits: `MAX_UPLOAD_MB` env (default 25) enforced in multer (or equivalent); allowlist of MIME types/extensions. Must match the Caddy `request_body max_size`. |
| B12 | Graceful shutdown on SIGTERM: stop accepting connections, close the DB (checkpoints WAL). |
| B13 | No secrets or PII in logs. Log to stdout/stderr only. |
| B14 | Backup helper `Backend/scripts/backup-db.js <dest-path>` using `better-sqlite3`'s `db.backup()` (or `VACUUM INTO`), followed by `PRAGMA integrity_check` on the copy; exit non-zero on failure. Must be runnable via `docker exec uninotes-backend node scripts/backup-db.js …` (the host has no `sqlite3`). |

---

## 4. Frontend requirements (`Frontend/`)

| # | Requirement |
|---|---|
| F1 | API base URL is **relative `/api`** in production (`VITE_API_BASE_URL=/api` or code default). No hard-coded hosts, no `localhost`. |
| F2 | Vite dev server proxy `/api` → backend for Codespaces dev, so code paths are identical in dev and prod. |
| F3 | Requests use `credentials: 'include'` (or same-origin default) so session cookies flow. |
| F4 | Attachment links point at the authenticated backend route (`/api/...`). Never construct file-system or static URLs. |
| F5 | Production build must succeed with limited memory. If needed, set `NODE_OPTIONS=--max-old-space-size=768` in the build stage. |

---

## 5. Dockerfiles (`docker/`)

**Backend:**
- Multi-stage. Builder: `node:20-alpine` (or 22) + `python3 make g++` **only if** native modules (e.g. `better-sqlite3`) need them; `npm ci --omit=dev`. Runtime: same base, copy `node_modules` + source, **no build toolchain**.
- `USER node` (uid 1000). `WORKDIR /app`. `EXPOSE` the internal port. Include `wget` or use `node -e` for the healthcheck.
- No `VOLUME` instruction (bind mounts are explicit in compose).
- `CMD ["node", "src/index.js"]` (exec form, so SIGTERM reaches Node). Consider `init: true` in compose.

**Frontend:**
- Builder: `npm ci && npm run build`. Runtime: `nginxinc/nginx-unprivileged:alpine` (listens on 8080, non-root) serving `dist/`.
- nginx config: SPA fallback `try_files $uri $uri/ /index.html;`; long-cache hashed `/assets/` (`immutable`), `no-cache` for `index.html`; `gzip off` (Caddy compresses); **no `/api` proxying** in the existing-proxy mode (Caddy routes `/api` directly to the backend).

**Both:**
- `.dockerignore` excluding `node_modules`, `dist`, `.env*`, `data/`, `*.db*`, `.git`, attachments.
- Pin base image major versions.

---

## 6. Environment files

`.env.example` (committed, **no real values**). Suggested keys:

```dotenv
# --- runtime (backend) ---
NODE_ENV=production
APP_ORIGIN=https://university.wesleyldshub.dev
SESSION_SECRET=            # generate on VPS: openssl rand -hex 32
TRUST_PROXY=1
MAX_UPLOAD_MB=25
# DB_PATH and ATTACHMENTS_DIR are set in compose; override only if needed

# --- compose interpolation (host side) ---
UNINOTES_TAG=latest
UNINOTES_DATA_DIR=/srv/UniNotes/data
UNINOTES_BACKEND_HOST_PORT=3002
UNINOTES_FRONTEND_HOST_PORT=3003
```

`.gitignore` must include: `.env`, `.env.*` (but not `.env.example`), `data/`, `*.db`, `*.db-wal`, `*.db-shm`, `backups/`, `node_modules/`, `dist/`.

---

## 7. Scripts (`scripts/`)

All bash, `set -euo pipefail`, runnable by `wesley` on the VPS from `/srv/UniNotes/app`, always using `docker compose -f compose.existing-proxy.yaml` (never a bare `docker compose`).

| Script | Behaviour |
|---|---|
| `scripts/preflight.sh` | Read-only checks: DNS resolves to `178.62.99.141`; ports 3002/3003 free or owned by uninotes; `/srv/UniNotes/data/{db,attachments}` exist and are owned by 1000; `.env` exists with mode 600 and required keys non-empty; `docker compose … config` passes and shows `name: uninotes` and only `127.0.0.1` bindings. Exit non-zero on any failure. |
| `scripts/backup.sh` | `docker exec uninotes-backend node scripts/backup-db.js /app/data/db/.backup-tmp.db`, then move to `/srv/UniNotes/backups/db/uninotes_<UTC stamp>.db`; tar `data/attachments` to `/srv/UniNotes/backups/attachments/`; prune (14 daily, 8 weekly); optional `rclone` off-site hook if `UNINOTES_RCLONE_REMOTE` is set. |
| `scripts/restore.sh <stamp>` | Stop backend only; move the current DB dir aside (never delete); restore the DB (+ attachments if `--with-attachments`); start backend; wait for healthy. Requires an interactive confirmation (`--yes` to skip). |
| `scripts/deploy.sh [<git-ref>]` | `preflight` → `git fetch` + checkout ref → `backup.sh` (if the backend is running) → `UNINOTES_TAG=$(git rev-parse --short HEAD)` build → `up -d` → wait for both healthchecks (timeout 120s) → `curl` local health. On failure, automatically re-`up` the previous tag (recorded in `/srv/UniNotes/.last_good_tag`). Never touches Caddy. |
| `scripts/rollback.sh [<tag>]` | Re-`up` a previous image tag (default `.last_good_tag`); optional `--restore-db <stamp>`. |
| `scripts/healthcheck.sh` | `curl` `127.0.0.1:3002/api/health`, `127.0.0.1:3003/`, and `https://university.wesleyldshub.dev/api/health`. |

Scripts must **never** run `docker system prune`, `docker compose down --remove-orphans` without `-f compose.existing-proxy.yaml`, or anything referencing `/srv/notes`, `notes-api` or project `app`.

---

## 8. Caddy snippet (committed, applied manually with sudo)

Add `deploy/Caddyfile.university` containing **only** the UniNotes site block (from `UNINOTES_DEPLOYMENT_ALIGNMENT.md` §5.1):

- `handle /api/*` → `reverse_proxy 127.0.0.1:3002` (no prefix stripping)
- `handle` → `reverse_proxy 127.0.0.1:3003`
- `request_body /api/* { max_size 25MB }`
- `encode zstd gzip`, security headers, access log to `/var/log/caddy/university.access.log` with rolling

Plus `deploy/README.md` documenting the apply and rollback commands (backup, append, `caddy validate`, `systemctl reload caddy`). Scripts must not edit `/etc/caddy`.

---

## 9. Documentation

Add `docs/DEPLOYMENT.md` (or extend `README.md`) covering: architecture diagram, directory layout, first-time setup (§10 of the alignment doc), deploy, backup/restore, rollback, and explicit "do not touch Notes" warnings.

---

## 10. Acceptance criteria (verify in Codespaces before handing back)

- [ ] `docker compose -f compose.existing-proxy.yaml config` succeeds and shows: `name: uninotes`; two services; every `ports` entry bound to `127.0.0.1`; no external networks; data mounts under `${UNINOTES_DATA_DIR}`.
- [ ] With `UNINOTES_DATA_DIR=$PWD/.localdata`, `up -d --build` brings both containers to **healthy**.
- [ ] `curl localhost:3002/api/health` → 200; `curl localhost:3003/` → SPA HTML; `curl localhost:3003/some/deep/route` → SPA HTML.
- [ ] With a local Caddy (or the dev proxy) emulating the production routing (`/api/*` → 3002 unstripped, else → 3003): login works, cookies are set, notes CRUD works, attachment upload, download and unauthorised-download-denied all work.
- [ ] Backend runs as uid 1000 (`docker exec uninotes-backend id`); files created in `.localdata` are owned by 1000.
- [ ] `scripts/backup.sh` (pointed at local paths) produces a DB that passes `integrity_check`; `scripts/restore.sh` round-trips it.
- [ ] Peak memory of `docker compose build` measured and reported (`/usr/bin/time -v` or `docker stats`), with a recommendation on whether 2 GB swap is required on the VPS.
- [ ] No secrets committed (`git grep -nEi 'secret|password|token' -- ':!*.example'` reviewed).
- [ ] `deploy/Caddyfile.university` passes `caddy validate` (`docker run --rm -v $PWD/deploy:/d caddy:2 caddy validate --config /d/Caddyfile.university --adapter caddyfile`; DNS isn't needed to validate).

---

## 11. Out of scope for Codespaces

- Anything on the VPS: DNS, swap, cloning, `.env` secrets, Caddy edits, cron install. These are done later, manually, following `UNINOTES_DEPLOYMENT_ALIGNMENT.md` §10.
- Any change to the Notes repository or its deployment.
