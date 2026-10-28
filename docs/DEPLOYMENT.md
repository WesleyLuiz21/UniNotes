# UniNotes — Production Deployment (VPS)

**Target:** `https://university.wesleyldshub.dev` on the DigitalOcean droplet `178.62.99.141`, alongside the existing **Notes** application (`notes.wesleyldshub.dev`), which must never be affected.

Background facts: [UNINOTES_VPS_DISCOVERY.md](UNINOTES_VPS_DISCOVERY.md), [UNINOTES_DEPLOYMENT_ALIGNMENT.md](UNINOTES_DEPLOYMENT_ALIGNMENT.md). The evidence for this setup is in [UNINOTES_PRODUCTION_PREPARATION_REPORT.md](UNINOTES_PRODUCTION_PREPARATION_REPORT.md).

> ### Do not touch Notes
>
> - Never edit anything under `/srv/notes`. Never touch the `notes-api` container, the Compose project `app`, the network `app_default`, port `3001` or the `notes.wesleyldshub.dev` Caddy block.
> - Never run `docker system prune`, `docker compose down --remove-orphans`, or any `docker compose` command without `-f compose.existing-proxy.yaml`. Use the scripts or `./scripts/compose.sh` instead.
> - Never run `compose.yaml` on the VPS. It starts its own Caddy on 80/443, which would collide with the host Caddy.
> - Caddy changes are made by hand with `sudo`, `reload` only (never `restart`). No script edits `/etc/caddy`.

---

## 1. Architecture

```
Internet ──80/443──► Caddy (host, systemd; /etc/caddy/Caddyfile)
                        │
   notes.wesleyldshub.dev (UNCHANGED)        university.wesleyldshub.dev  (deploy/Caddyfile.university)
     /api/* → 127.0.0.1:3001 (notes-api)       /api/* → 127.0.0.1:3002 ─► uninotes-backend  (Express + SQLite)
     else  → /srv/notes/frontend              else   → 127.0.0.1:3003 ─► uninotes-frontend (static SPA, unprivileged Caddy :8080)
                                              Docker project "uninotes", private network "uninotes_default"
```

| | Notes (existing) | UniNotes |
|---|---|---|
| Directory | `/srv/notes` | `/srv/UniNotes/{app,data,backups}` |
| Compose project / file | `app` / `docker-compose.yml` | **`uninotes`** / **`compose.existing-proxy.yaml`** |
| Containers | `notes-api` | `uninotes-backend`, `uninotes-frontend` |
| Host ports | `127.0.0.1:3001` | `127.0.0.1:3002` (API), `127.0.0.1:3003` (SPA) |
| Memory limits | none | backend 512 MiB, frontend 64 MiB |

**Why loopback only:** ports that Docker publishes bypass `ufw`. Every UniNotes port is bound to `127.0.0.1`, so only the host Caddy can reach the containers.

**Path handling:**
- Caddy does **not** strip `/api`, because Express serves every route under `/api`.
- The frontend never answers `/api/*`.
- The attachments directory is never served statically. Files are only streamed through authenticated, ownership-checked backend routes.

---

## 2. Directory layout on the VPS

```
/srv/UniNotes/                 wesley:wesley 0755
├── app/                       git clone of this repository (code only; safe to re-clone)
│   └── .env                   0600, generated on the VPS, never committed
├── data/                      1000:1000 0750
│   ├── db/                    1000:1000 0700   uninotes.db (+ -wal, -shm)
│   └── attachments/           1000:1000 0700   opaque file names
├── backups/                   1000:1000 0700   local/<stamp>/ (verified snapshots), pre-migration/, pre-restore-*/, caddy/
├── .last_good_tag             written by deploy.sh / rollback.sh
└── .previous_tag
```

uid/gid 1000 is `wesley` on the host and `node` inside the backend container, so bind-mounted files have the correct owner with no `chown` tricks.

---

## 3. Build strategy (1.9 GiB RAM, no swap)

Peak memory, measured in Codespaces:

| Build | Peak memory | Time |
|---|---:|---:|
| Backend image | 587 MiB | 41 s |
| Frontend: Vite build | 1,009 MiB | 40 s |
| Frontend: Caddy compiled with Go (xcaddy) | 1,119 MiB | 193 s |

With about 1.3 GiB available and no swap, building on the VPS risks the OOM killer, and it could kill `notes-api`.

**Recommended:** build in Codespaces (or CI) and ship the images:

```bash
# In Codespaces, on the commit you want to release (commit and push it first):
./scripts/build-images.sh                       # uninotes-backend:<sha>, uninotes-frontend:<sha>
./scripts/ship-images.sh wesley@178.62.99.141   # docker save | ssh | docker load (only loads images)

# On the VPS:
cd /srv/UniNotes/app && git fetch && git checkout <same sha>
./scripts/deploy.sh --no-build
```

**Alternative:** build on the VPS only after adding swap (needs `sudo`; it does not affect Notes):

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf && sudo sysctl --system
```

`deploy.sh` (without `--no-build`) builds one image at a time, and warns when there is no swap.

**Runtime is light:** measured peaks were 127 MiB for the backend (while processing a 5405×3901 image and a full export) and 15 MiB for the frontend.

---

## 4. First-deployment checklist

Tick each item. Stop at the first failure.

### A. Before touching the VPS
- [ ] Commit and push this repository. Note the release commit: `git rev-parse --short=12 HEAD`.
- [ ] Optional but recommended: take a **droplet snapshot** in the DigitalOcean panel.
- [ ] In Codespaces, export your current notes: `cd Backend && npm run backup`. This writes a verified snapshot to `Backend/data/backups/local/<stamp>/` (database, attachments and manifest).

### B. DNS (Namecheap)
- [ ] Add an `A` record: host `university`, value `178.62.99.141`, TTL Automatic. **No AAAA record.**
- [ ] Wait until `dig +short university.wesleyldshub.dev` prints `178.62.99.141`.

### C. Directories and code (as `wesley`)
```bash
mkdir -p /srv/UniNotes/data/db /srv/UniNotes/data/attachments /srv/UniNotes/backups
chmod 700 /srv/UniNotes/data/db /srv/UniNotes/data/attachments /srv/UniNotes/backups
chmod 750 /srv/UniNotes/data
# (/srv is owned by wesley = uid 1000; if not: sudo chown -R 1000:1000 /srv/UniNotes/data /srv/UniNotes/backups)
git clone <UniNotes repository URL> /srv/UniNotes/app
cd /srv/UniNotes/app && git checkout <release sha>
```
- [ ] Done.

### D. Configuration
```bash
cd /srv/UniNotes/app
cp .env.example .env && chmod 600 .env
openssl rand -base64 48            # paste as APP_SECRET_KEY (store a copy in your password manager)
nano .env                          # UNINOTES_ORIGIN=https://university.wesleyldshub.dev; layout defaults are already correct
```
- [ ] `.env` is mode 600 and contains a new `APP_SECRET_KEY`. Your Codespaces data has no MFA or recovery codes enrolled, so a new key is fine.
- [ ] `./scripts/preflight.sh` reports **All required checks passed**. The DNS and Caddy-block warnings are expected before step G.

### E. Images and first start
- [ ] Images: either ship them from Codespaces (§3) and run `./scripts/deploy.sh --no-build`, or add swap and run `./scripts/deploy.sh`.
- [ ] `deploy.sh` ends with `Deployment of <sha> complete.` Both containers are healthy.
- [ ] `./scripts/healthcheck.sh --local` shows all OK.
- [ ] `docker ps` shows `notes-api` with the **same container ID and uptime** as before.

### F. Bring your notes across (from step A)
```bash
# Codespaces → VPS (the backup is a directory: uninotes.db + attachments/ + manifest.json)
scp -r Backend/data/backups/local/<stamp> wesley@178.62.99.141:/srv/UniNotes/backups/local/
# On the VPS
cd /srv/UniNotes/app
./scripts/restore.sh <stamp> --verify-only        # checksums, integrity, attachments
./scripts/restore.sh <stamp>                      # confirm with y
```
- [ ] The restore reports the expected counts: your notes, plus 382+ attachments at the time of writing.
- [ ] You sign in later with your **Codespaces** username (`switchback`) and password.
- [ ] Alternatively, start empty and run `./scripts/compose.sh run --rm -it backend node dist/scripts/create-user.js`.

### G. Caddy (`sudo`; only after E passes)
- [ ] Follow [deploy/README.md](../deploy/README.md): backup → append once → `caddy validate` → `systemctl reload caddy`.
- [ ] `curl -sI https://notes.wesleyldshub.dev | head -1` still returns 200.
- [ ] `curl -s https://university.wesleyldshub.dev/api/health` returns `{"data":{"status":"ok","database":"ok"}}`.
- [ ] `diff` of the Caddyfile backup against the live file shows **only added lines**.

### H. Functional checks (browser)
- [ ] Sign in, open notes with images, edit a note (autosave), and upload/download an attachment.
- [ ] Use search and the calendar.
- [ ] Sign out.
- [ ] Enable two-factor authentication: Settings → Security.
- [ ] `./scripts/healthcheck.sh` (local and public) shows all OK.

### I. Backups
- [ ] `./scripts/backup.sh --local` succeeds.
- [ ] `./scripts/restore.sh latest --verify-only` succeeds.
- [ ] Recommended: configure off-site backups (`RESTIC_*` in `.env`, e.g. DigitalOcean Spaces), then run `./scripts/backup.sh`.
- [ ] Install the cron entries (`crontab -e` as `wesley`):
  ```cron
  17 3 * * *  /srv/UniNotes/app/scripts/backup.sh >> /srv/UniNotes/backups/backup.log 2>&1
  47 3 * * 0  /srv/UniNotes/app/scripts/backup.sh --check >> /srv/UniNotes/backups/backup.log 2>&1
  ```
- [ ] Store `APP_SECRET_KEY` and `RESTIC_PASSWORD` in your password manager.

### J. Final confirmation that Notes was unaffected
- [ ] `notes-api` has the same container ID and uptime.
- [ ] `https://notes.wesleyldshub.dev` returns 200.
- [ ] The Notes Caddy block is byte-identical.
- [ ] Nothing changed under `/srv/notes`.

---

## 5. Routine operations

| Task | Command (from `/srv/UniNotes/app`) |
|---|---|
| Deploy a new release | `./scripts/deploy.sh --ref <tag-or-sha>` (add `--no-build` when images were shipped) |
| Health | `./scripts/healthcheck.sh` |
| Logs | `./scripts/compose.sh logs -f --tail 100 backend` |
| Status | `./scripts/compose.sh ps` |
| Backup now | `./scripts/backup.sh` (or `--local`) |
| List / verify backups | `./scripts/restore.sh --list`, `./scripts/restore.sh <stamp> --verify-only` |
| Reset a password | `./scripts/compose.sh run --rm -it backend node dist/scripts/reset-password.js --username <name>` |

`deploy.sh` runs these steps in order:
1. preflight;
2. check out the release, if `--ref` is given;
3. images tagged with the git short SHA;
4. a verified backup, if a database exists;
5. explicit migrations;
6. start the containers;
7. health gates (container health, local API and SPA checks);
8. record `.last_good_tag`.

If the new release is not healthy, it **automatically restarts the previous good release**. It never touches Caddy.

---

## 6. Rollback and recovery

| Situation | Action | Effect on Notes |
|---|---|---|
| New release misbehaves, no schema change | `./scripts/rollback.sh` (previous tag) or `--to <tag>` | None |
| New release applied a migration | `./scripts/rollback.sh --to <tag> --restore-db latest`. `latest` is the backup `deploy.sh` took just before migrating. Without `--restore-db`, the script refuses when the database is ahead of the target release | None |
| Data problem | `./scripts/restore.sh <stamp>`. The current data is preserved first in `backups/pre-restore-<time>/` | None |
| Remove the Caddy site | Restore the Caddyfile backup, `validate`, `reload` (see [deploy/README.md](../deploy/README.md)) | None |
| Remove UniNotes entirely | `./scripts/compose.sh down`, then remove the Caddy block and reload. Keep `/srv/UniNotes/data` until you are sure | None |
| Droplet lost | New droplet: install Docker, clone, recreate `.env` (same `APP_SECRET_KEY` and `RESTIC_*`), `./scripts/deploy.sh`, `./scripts/restore.sh restic:latest --yes`, DNS, Caddy | — |
| Catastrophic | Restore the droplet snapshot from checklist step A | **Reverts Notes too**, so last resort only |

Previous images stay on the host, so a rollback needs no rebuild. To list them, run `./scripts/rollback.sh --list`. Prune old tags by hand with `docker rmi uninotes-backend:<old>`, never with `docker system prune`.
