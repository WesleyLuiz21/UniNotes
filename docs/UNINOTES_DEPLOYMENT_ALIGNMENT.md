# UniNotes — Deployment Alignment Plan

**Target:** `https://university.wesleyldshub.dev`
**Host:** DigitalOcean Droplet `178.62.99.141` (see `UNINOTES_VPS_DISCOVERY.md`)
**Status:** PLAN ONLY. Nothing in this document has been executed.

### Legend

| Tag | Meaning |
|---|---|
| ✅ | Based on a verified VPS fact |
| ⚠️ | Assumption about the UniNotes repository that Codespaces must confirm or conform to |
| 🔒 | Requires `sudo` on the VPS |

---

## 1. Guiding principles

1. **Notes is never touched.** No edits under `/srv/notes`, no changes to the `notes-api` container, the `app` Compose project, the `app_default` network, or the existing Caddy site block.
2. **Mirror the pattern that actually works today** ✅: host Caddy → container ports published on `127.0.0.1` only. No shared Docker network is needed or desired.
3. **Full isolation:** own directory, Compose project name, containers, network, `.env`, data, backups and rollback.
4. **Every change is reversible** with a documented one-step rollback.

---

## 2. Target architecture

```
                Internet
                    │ 80/443
            ┌───────▼────────┐  host systemd service (existing)
            │     Caddy      │  /etc/caddy/Caddyfile
            └──┬──────────┬──┘
   notes.wesleyldshub.dev │ university.wesleyldshub.dev
     (UNCHANGED)          │
  /api/* → 127.0.0.1:3001 │  /api/* → 127.0.0.1:3002 ─► uninotes-backend  (Express + SQLite)
  else  → /srv/notes/     │  else   → 127.0.0.1:3003 ─► uninotes-frontend (static Vite build)
          frontend        │
                          │   Docker project "uninotes", network "uninotes_default" (private)
                          │
                 /srv/UniNotes/data/db           → backend:/app/data/db
                 /srv/UniNotes/data/attachments  → backend:/app/data/attachments  (never web-served)
```

| Item | Notes (existing) ✅ | UniNotes (proposed) |
|---|---|---|
| Directory | `/srv/notes` | `/srv/UniNotes` |
| Compose project | `app` (implicit) | `uninotes` (**explicit `name:`**) |
| Compose file | `docker-compose.yml` | `compose.existing-proxy.yaml` |
| Containers | `notes-api` | `uninotes-backend`, `uninotes-frontend` |
| Network | `app_default` | `uninotes_default` (auto-created, private) |
| Backend port | `127.0.0.1:3001` | `127.0.0.1:3002` |
| Frontend | static files served by Caddy | container on `127.0.0.1:3003` |
| Data | `/srv/notes/db` | `/srv/UniNotes/data/{db,attachments}` |
| Backups | none | `/srv/UniNotes/backups` + off-site copy |

**Why a frontend container rather than host static files?** The repository already ships separate frontend and backend containers ⚠️. Keeping the frontend in a container makes deploys and rollbacks atomic (one image tag per release) and avoids host-side `npm` builds. Cost: ~10 MB RAM for nginx.

---

## 3. Directory layout on the VPS

```
/srv/UniNotes/                   wesley:wesley 0755
├── app/                         git clone of the UniNotes repo (wesley:wesley)
│   ├── Frontend/  Backend/  docker/  scripts/
│   ├── compose.yaml                     (dev / self-contained, NOT used on VPS)
│   ├── compose.existing-proxy.yaml      (used on VPS)
│   └── .env                     0600 wesley:wesley   (never committed)
├── data/                        1000:1000 0750
│   ├── db/                      1000:1000 0700   uninotes.db (+ -wal, -shm)
│   └── attachments/             1000:1000 0700
└── backups/                     wesley:wesley 0700
    ├── db/                      timestamped consistent SQLite snapshots
    ├── attachments/             timestamped tarballs
    └── caddy/                   Caddyfile copies taken before each edit
```

- Placing the repo in `/srv/UniNotes/app` and data **outside** the git checkout means `git clean`, `git reset` or a re-clone can never destroy data.
- uid/gid **1000** is `wesley` on the host ✅ and also `node` in `node:*-alpine` images. Running the backend as `node` (uid 1000) gives correct ownership on bind mounts with no `chown` tricks and no root in the container.
- The Compose project name is set explicitly, so the directory name `app` here does **not** collide with Notes' implicit `app` project. (This is exactly why the explicit `name: uninotes` is mandatory.)

---

## 4. Docker / Compose configuration (target shape)

The authoritative file is produced in Codespaces (see `UNINOTES_CODESPACES_HANDOFF.md`). Target shape:

```yaml
name: uninotes

services:
  backend:
    image: uninotes-backend:${UNINOTES_TAG:-latest}
    build: { context: ., dockerfile: docker/backend.Dockerfile }   # ⚠️ path per repo
    container_name: uninotes-backend
    restart: unless-stopped
    user: "1000:1000"
    env_file: ./.env
    environment:
      NODE_ENV: production
      PORT: 3002
      DB_PATH: /app/data/db/uninotes.db
      ATTACHMENTS_DIR: /app/data/attachments
      TRUST_PROXY: "1"
    volumes:
      - ${UNINOTES_DATA_DIR:-/srv/UniNotes/data}/db:/app/data/db
      - ${UNINOTES_DATA_DIR:-/srv/UniNotes/data}/attachments:/app/data/attachments
    ports:
      - "127.0.0.1:${UNINOTES_BACKEND_HOST_PORT:-3002}:3002"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3002/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    mem_limit: 384m
    security_opt: ["no-new-privileges:true"]
    read_only: true
    tmpfs: ["/tmp"]
    logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }

  frontend:
    image: uninotes-frontend:${UNINOTES_TAG:-latest}
    build: { context: ., dockerfile: docker/frontend.Dockerfile }  # ⚠️ path per repo
    container_name: uninotes-frontend
    restart: unless-stopped
    ports:
      - "127.0.0.1:${UNINOTES_FRONTEND_HOST_PORT:-3003}:8080"
    depends_on:
      backend: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8080/"]
      interval: 30s
      timeout: 5s
      retries: 3
    mem_limit: 64m
    security_opt: ["no-new-privileges:true"]
    logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }
```

Key points:
- **Only `127.0.0.1:` port bindings.** Docker-published ports bypass ufw ✅, so a bare `"3002:3002"` would expose the API to the internet.
- **No `caddy` service and no external network** in this file. Caddy already exists on the host ✅.
- **Never run `docker compose down --remove-orphans` without `-p uninotes` / the explicit project file.** Always invoke as `docker compose -f compose.existing-proxy.yaml …` from `/srv/UniNotes/app`.
- Memory limits (384m + 64m) keep UniNotes from starving Notes on a 1.9 GiB host ✅.

---

## 5. Caddy configuration

### 5.1 Block to append (do not alter the existing `notes.wesleyldshub.dev` block)

```caddyfile
university.wesleyldshub.dev {
    encode zstd gzip

    # Upload ceiling for attachments (keep in sync with backend limit)
    request_body /api/* {
        max_size 25MB
    }

    # Backend: path is NOT stripped; Express mounts routes under /api   ⚠️ see handoff
    handle /api/* {
        reverse_proxy 127.0.0.1:3002
    }

    # Frontend SPA container
    handle {
        reverse_proxy 127.0.0.1:3003
    }

    header {
        Strict-Transport-Security "max-age=31536000"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        -Server
    }

    log {
        output file /var/log/caddy/university.access.log {
            roll_size 10MiB
            roll_keep 5
        }
    }
}
```

- `handle` (not `handle_path`) keeps `/api` in the path, so backend routes, the healthcheck URL and frontend calls all use the same prefix in dev and prod. This is deliberately different from Notes' `handle_path`. Either works, but the backend must match whichever is chosen.
- `/var/log/caddy` exists and is owned by `caddy` ✅.
- Caddy will obtain a Let's Encrypt certificate automatically on first request **once DNS resolves** ✅ (renewal for Notes works today).

### 5.2 Safe apply procedure 🔒

```bash
sudo cp /etc/caddy/Caddyfile /srv/UniNotes/backups/caddy/Caddyfile.$(date +%F_%H%M%S)
sudo tee -a /etc/caddy/Caddyfile < /srv/UniNotes/app/deploy/Caddyfile.university   # ⚠️ file produced by Codespaces
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy          # graceful; on a bad config Caddy keeps the old one
curl -sI https://notes.wesleyldshub.dev | head -1        # must still be 200
curl -sI https://university.wesleyldshub.dev | head -1
```

Use **`reload`, never `restart`**: reload is zero-downtime, and if the new config fails to load Caddy keeps serving the previous one.

---

## 6. DNS

At **Namecheap** (authoritative NS `dns1/dns2.registrar-servers.com` ✅):

| Type | Host | Value | TTL |
|---|---|---|---|
| A | `university` | `178.62.99.141` | Automatic / 300 |

- **No AAAA record.** The droplet has no IPv6 ✅. An AAAA would break clients and the ACME challenge.
- Create the record **first** and confirm with `dig +short university.wesleyldshub.dev` before adding the Caddy block. Otherwise Caddy will repeatedly fail ACME challenges and may hit Let's Encrypt rate limits.

---

## 7. Storage

| Data | Host path | Container path | Notes |
|---|---|---|---|
| SQLite DB | `/srv/UniNotes/data/db/` | `/app/data/db/` | Mount the **directory**, not the file, so `-wal`/`-shm` live beside it |
| Attachments | `/srv/UniNotes/data/attachments/` | `/app/data/attachments/` | Private. Served only through authenticated backend routes, never by Caddy or the frontend container |

- Ownership `1000:1000`, directories `0700`, so other host users cannot read DB or attachments (an improvement on Notes' world-readable DB ✅).
- Bind mounts (not named volumes) keep data visible for backup scripts and consistent with Notes.

---

## 8. Security

| Control | Plan |
|---|---|
| Network exposure | Loopback-only ports; no new ufw rules required |
| TLS | Caddy automatic HTTPS + HSTS |
| Container | Non-root (`1000:1000`), `no-new-privileges`, read-only root FS on backend, memory limits |
| Secrets | `/srv/UniNotes/app/.env` mode `0600`; generated on the VPS (`openssl rand -hex 32`); never committed; never shared with Notes |
| Cookies | `Secure`, `HttpOnly`, `SameSite=Lax`; Express `trust proxy` = 1 so `req.secure` is correct behind Caddy |
| CORS | Same origin, so no CORS needed; if enabled, allow only `https://university.wesleyldshub.dev` |
| Attachments | Auth-checked download route; `Content-Disposition: attachment` for non-images; `X-Content-Type-Options: nosniff`; random server-side filenames; size and type limits |
| Upload size | Caddy `max_size 25MB` and backend limit, kept equal |
| Logs | Rotation on containers and the Caddy site log |

**Pre-existing items worth addressing separately** (not part of this deployment, and they don't touch Notes' runtime):
- `chmod 600 /srv/notes/app/.env` (currently 0664).
- Confirm `PermitRootLogin` and consider `prohibit-password` or `no` 🔒.
- Add a Notes backup job (see §9.4).

---

## 9. Backups

### 9.1 What to back up
1. **SQLite DB:** must be a **consistent online snapshot**, never a raw `cp` of the `.db` file. Notes shows why: its data sits almost entirely in the uncheckpointed WAL ✅.
2. **Attachments directory:** tarball.
3. **`.env`:** stored separately, encrypted or in a password manager (not in the repo, and ideally not in the same tarball that goes off-site).

### 9.2 Mechanism
- `scripts/backup.sh` (from Codespaces) runs **inside the backend container** via `docker exec uninotes-backend node scripts/backup-db.js <dest>`, using `better-sqlite3`'s `db.backup()` or `VACUUM INTO`. This avoids needing `sqlite3` on the host (it isn't installed ✅).
- Output: `/srv/UniNotes/backups/db/uninotes_YYYY-MM-DD_HHMMSS.db` and `attachments_YYYY-MM-DD_HHMMSS.tar.gz`.
- Verify each snapshot with `PRAGMA integrity_check`.
- Retention: 14 daily + 8 weekly.

### 9.3 Schedule and off-site
- `wesley` user crontab (no sudo needed; `wesley` is in `docker` group ✅):
  `17 3 * * * /srv/UniNotes/app/scripts/backup.sh >> /srv/UniNotes/backups/backup.log 2>&1`
- **Off-site copy is required.** On-droplet backups don't survive loss of the droplet. Options: DigitalOcean Spaces via `rclone`, or enable DigitalOcean Droplet Backups (❓ current state unknown).

### 9.4 Notes
Notes has **no backups** ✅. A separate, read-only-to-Notes job (`docker exec notes-api node -e "…db.backup(…)"` to a path under `/srv/notes-backups`) is strongly recommended, but as its own change.

### 9.5 Restore procedure
```bash
cd /srv/UniNotes/app
docker compose -f compose.existing-proxy.yaml stop backend
mv /srv/UniNotes/data/db /srv/UniNotes/data/db.broken.$(date +%s)
mkdir -m 700 /srv/UniNotes/data/db
cp /srv/UniNotes/backups/db/uninotes_<STAMP>.db /srv/UniNotes/data/db/uninotes.db
tar -xzf /srv/UniNotes/backups/attachments/attachments_<STAMP>.tar.gz -C /srv/UniNotes/data   # if needed
docker compose -f compose.existing-proxy.yaml start backend
```
**Test a restore once before go-live.**

---

## 10. Deployment runbook (for later, not executed)

| # | Step | sudo | Affects Notes? |
|---|---|---|---|
| 0 | Optional but recommended: snapshot the droplet in the DigitalOcean panel | — | No |
| 1 | Add Namecheap A record; wait until `dig` resolves | — | No |
| 2 | Add 2 GB swap (`fallocate`, `mkswap`, `swapon`, `/etc/fstab`, `vm.swappiness=10`), **or** build images off-box and pull (see §11) | 🔒 | No (reduces OOM risk for Notes) |
| 3 | `sudo mkdir -p /srv/UniNotes && sudo chown wesley:wesley /srv/UniNotes` (`/srv` is owned by wesley ✅, so sudo may not be needed) | maybe | No |
| 4 | `git clone <UniNotes repo> /srv/UniNotes/app` and `git checkout <release tag>` | — | No |
| 5 | Create data/backup dirs with ownership and modes from §3 | — | No |
| 6 | `cp .env.example .env && chmod 600 .env`; fill secrets on the VPS | — | No |
| 7 | `docker compose -f compose.existing-proxy.yaml config` (lint; confirm `name: uninotes` and `127.0.0.1` ports) | — | No |
| 8 | `UNINOTES_TAG=$(git rev-parse --short HEAD) docker compose -f compose.existing-proxy.yaml build` | — | No (RAM pressure only) |
| 9 | `… up -d` then `docker ps` (both healthy) and `curl 127.0.0.1:3002/api/health`, `curl 127.0.0.1:3003/` | — | No |
| 10 | Apply Caddy block per §5.2 | 🔒 | Graceful reload only |
| 11 | Verify Notes 200 and University 200; test login, note CRUD, attachment upload/download | — | — |
| 12 | Run `scripts/backup.sh` manually, test a restore, then install the cron | — | No |

**Final verification that Notes was unaffected:** `docker ps` still shows `notes-api` with the same container ID and uptime; `https://notes.wesleyldshub.dev` returns 200; the Notes Caddy block is byte-identical (`diff` against the backup).

---

## 11. Build strategy (resource constraint)

With 1.9 GiB RAM and no swap ✅, choose one:

| Option | Pros | Cons |
|---|---|---|
| **A. Add 2 GB swap, build on VPS** (recommended for V1) | Simple; matches Notes workflow | Requires sudo; slower builds |
| B. Build in GitHub Actions and push to GHCR; VPS only `pull`s | No build load on VPS; immutable tags | More setup; registry auth on VPS |
| C. Build in Codespaces, `docker save \| ssh … docker load` | No registry | Manual; large transfers |

Whichever is chosen, tag images with the git short SHA so rollback is a tag switch.

---

## 12. Rollback

| Scope | Action | Effect on Notes |
|---|---|---|
| **Caddy** | `sudo cp /srv/UniNotes/backups/caddy/Caddyfile.<stamp> /etc/caddy/Caddyfile && sudo caddy validate … && sudo systemctl reload caddy` | None (block removed; Notes block identical) |
| **App release** | `git checkout <prev tag>`; `UNINOTES_TAG=<prev sha> docker compose -f compose.existing-proxy.yaml up -d` (previous images retained locally) | None |
| **Data** | Restore procedure §9.5 using the pre-deploy backup | None |
| **Full removal** | `docker compose -f compose.existing-proxy.yaml down` (project `uninotes` only); remove the Caddy block and reload; keep `/srv/UniNotes/data` until certain | None |
| **Catastrophic** | Restore the droplet snapshot from step 0 | Reverts Notes too, so last resort only |

`deploy.sh` must take a DB and attachment backup **before** starting new containers whenever migrations may run.

---

## 13. Open decisions for the owner

1. Build strategy: §11 A, B or C.
2. Off-site backup target (DigitalOcean Spaces? Droplet Backups?).
3. Attachment size limit (25 MB assumed).
4. Whether to fix the pre-existing Notes hygiene items (`.env` mode, backups, SSH root login) in a separate change.
