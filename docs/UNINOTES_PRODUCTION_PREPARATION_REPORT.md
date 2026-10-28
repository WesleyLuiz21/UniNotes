# UniNotes — Production Preparation Report

**Target:** `https://university.wesleyldshub.dev` on droplet `178.62.99.141`, beside the existing Notes app.
**Prepared:** 2026-10-28, in GitHub Codespaces.
**Scope:** repository changes and Codespaces-side verification only. **The VPS was not accessed; nothing was deployed; DNS, Caddy and Notes are untouched.**
**Runbook:** [DEPLOYMENT.md](DEPLOYMENT.md). **Caddy snippet:** [deploy/Caddyfile.university](../deploy/Caddyfile.university).

---

## 1. Readiness assessment

**Ready from the Codespaces side.** The repository now deploys to the verified VPS architecture:
- the host's systemd Caddy;
- loopback ports 3002 and 3003;
- Compose project `uninotes`;
- `/srv/UniNotes/{app,data,backups}`.

All of the following were exercised end to end, against a replica of that layout:
- deploy, health gates, backup, restore and rollback (including automatic rollback, and rollback across a schema migration);
- authentication and attachment security;
- moving your imported notes to the server.

Only the manual VPS steps in §6 remain.

| Gate | Status |
|---|---|
| Compose: project `uninotes`, 2 services, no proxy container, no external networks, `127.0.0.1` ports only | ✅ verified (`compose config`, preflight, CI job) |
| Containers healthy; backend uid 1000; read-only root filesystem; `cap_drop ALL`; `no-new-privileges`; memory limits; log rotation | ✅ verified on the replica |
| Login, cookies, CSRF, note CRUD, uploads and downloads, cross-user and anonymous denial, through the real Caddy snippet | ✅ 26/26 checks; 15/15 Playwright tests via the edge |
| Backup → restore round trip; data migration from Codespaces | ✅ |
| Deploy, rollback, automatic rollback, and migration-aware rollback | ✅ (two bugs found and fixed, §3) |
| Caddy snippet validates, alone and appended after the live Notes block | ✅ |
| Building images on the VPS without swap | ⚠️ **not recommended**: peaks at ~1.1 GiB. Build off-box (§2.3) or add swap first |

---

## 2. Changes made

### 2.1 Gap analysis (repository vs. VPS reports)

**What the repository already satisfied** (left unchanged and re-verified):
- every route is under `/api`;
- `GET /api/health` runs a `SELECT 1` check;
- `TRUST_PROXY=1`;
- `__Host-` Secure, HttpOnly, SameSite session cookies;
- Origin-checked CSRF, and no CORS;
- the production secret-strength check;
- WAL, foreign-key and `busy_timeout` pragmas;
- explicit versioned migrations;
- graceful SIGTERM shutdown;
- private, ownership-checked attachments served with `nosniff` and a sandbox CSP;
- an online-backup tool with verification;
- the frontend uses relative `/api` and same-origin credentials, with a Vite dev proxy;
- non-root, multi-stage images.

The gaps closed:

| # | Gap | Fix |
|---|---|---|
| G1 | `compose.existing-proxy.yaml` was an overlay that kept the **bundled Caddy** and joined an external Docker network | Rewritten as a **standalone** file: `name: uninotes`, `backend` + `frontend` only, `container_name`s, no networks beyond the project default |
| G2 | No loopback ports for the host Caddy | `127.0.0.1:${UNINOTES_BACKEND_HOST_PORT:-3002}:3000`, `127.0.0.1:${UNINOTES_FRONTEND_HOST_PORT:-3003}:8080` |
| G3 | Named volumes | Bind mounts: `${UNINOTES_DATA_DIR:-/srv/UniNotes/data}/{db,attachments}` and `${UNINOTES_BACKUP_DIR:-/srv/UniNotes/backups}`; the backend runs as `user: 1000:1000` |
| G4 | Scripts called bare `docker compose`, which defaults to `compose.yaml` and **would start a Caddy on 80/443** | `scripts/_common.sh` always uses `-f <UNINOTES_COMPOSE_FILE>` (default `compose.existing-proxy.yaml`; only two allowed values) and the recorded image tag. New `scripts/compose.sh` wrapper for ad-hoc commands (refuses `-v`, `--remove-orphans`, `--rmi`) |
| G5 | No image tags, no rollback, no auto-rollback | Images are tagged with the git short SHA. `deploy.sh` records `.last_good_tag`/`.previous_tag` outside the repo and auto-rolls back. New `rollback.sh` with schema-compatibility guard and `--restore-db`. New `healthcheck.sh` |
| G6 | Preflight written for the old A/B/C decision | Rewritten (read-only): `.env` mode and keys; compose isolation (name, services, loopback ports, external networks, container names, mounts); directory ownership; port conflicts (3001/2019 reserved); host Caddy block; DNS A record and no AAAA; memory and swap; disk |
| G7 | Frontend build peaks at ~1.1 GiB (Vite, plus Caddy compiled from Go) | **Measured** (§4.6). New `build-images.sh` and `ship-images.sh`, and `deploy.sh --no-build`. On-VPS builds run one at a time and warn without swap. The images themselves are unchanged |
| G8 | No host-Caddy snippet or runbook | `deploy/Caddyfile.university`, `deploy/README.md` (apply/verify/rollback), `docs/DEPLOYMENT.md` |
| G9 | `.env.example` and README described example domains and the old options | Rewritten for the VPS (values, layout, ports, memory limits); README production sections replaced; bundled mode kept as a clearly separated alternative |
| G10 | `VOLUME` instructions could silently create anonymous volumes | Removed: with a read-only root filesystem, a missing mount now fails loudly |
| G11 | `.localdata/` and `backups/` not ignored | Added to `.gitignore` |
| G12 | No path to bring the imported Codespaces notes to the VPS | Documented and rehearsed: Codespaces `npm run backup` → `scp` → `restore.sh` (§4.5) |

### 2.2 Files

| File | Change |
|---|---|
| `compose.existing-proxy.yaml` | Rewritten (production VPS file) |
| `compose.yaml` | Header: "NOT for the VPS" (otherwise unchanged; still renders) |
| `Backend/Dockerfile` | Removed the `VOLUME` instruction (comment explains why) |
| `Backend/src/server.ts` | The "pending migrations" log message now names the safe commands (it suggested a bare `docker compose`) |
| `scripts/_common.sh` | Compose file pinning, state directory, tag resolution, non-fatal `wait_healthy`, `image_exists` |
| `scripts/deploy.sh` | Rewritten: `--ref`, `--no-build`, preflight, sequential builds, backup before migrating, health gates, automatic rollback |
| `scripts/preflight.sh` | Rewritten for this VPS (read-only) |
| `scripts/rollback.sh`, `healthcheck.sh`, `compose.sh`, `build-images.sh`, `ship-images.sh` | New |
| `scripts/backup.sh` | Cron example updated to `/srv/UniNotes` |
| `deploy/Caddyfile.university`, `deploy/README.md` | New |
| `.env.example` | Rewritten for the VPS (no real values) |
| `.gitignore` | `.localdata/`, `backups/` |
| `.gitleaksignore` | Allow-lists one **test-only** password in `Backend/test/migrations.test.ts` (commit `5946cfd`). It was making CI's history secret scan fail (§3) |
| `.github/workflows/ci.yml` | New `deploy-config` job: shellcheck; compose isolation and loopback assertions; `caddy validate` on the snippet |
| `README.md`, `docs/DEPLOYMENT.md`, `docs/SECURITY.md`, `PRODUCTION_READINESS.md` | Deployment docs updated; the old audit is marked historical |

### 2.3 Deliberate differences from the handoff document

| Handoff | Implemented | Why |
|---|---|---|
| Internal ports 3002/8080, container paths `/app/data/...`, `DB_PATH`, `SESSION_SECRET`, `MAX_UPLOAD_MB` | Internal 3000/8080, `/data/...`, `DATA_DIR`, `APP_SECRET_KEY`, `MAX_ATTACHMENT_MB` | Existing names and paths already work and are used by the scripts and tests. Only the **host** side had to match (ports 3002/3003, `/srv/UniNotes/...`) |
| `env_file: ./.env` | Explicit `environment:` list | `.env` may hold restic or S3 credentials, which the backend must not see |
| Backend `mem_limit: 384m` | 512m (configurable) | Measured peak is 127 MiB, but uploads may be up to 40 megapixels, which is about 160 MB decoded. 512m keeps headroom and still leaves Notes ample memory |
| `backup-db.js` + tarball, 14 daily + 8 weekly | Existing `dist/scripts/backup.js`: online SQLite backup, attachments, manifest, verification. `LOCAL_BACKUP_KEEP=14`; restic for off-site (30 daily / 8 weekly / 6 monthly) | Already stronger: verified, consistent pairs of database and attachments |
| nginx-unprivileged frontend | Existing unprivileged Caddy static server (15 MiB measured) | It works, and already sets CSP and security headers. The build cost is addressed by building off-box |
| Caddy `max_size 25MB` | `30MB` | 25 MB file plus multipart overhead; otherwise a file at exactly the limit would be refused by Caddy |

---

## 3. Defects found and fixed during testing

1. **`deploy.sh` could leave the site down.** When a new backend never became healthy, `docker compose up` failed: the frontend depends on a healthy backend. Under `set -e` the script then aborted **before** its rollback, with the frontend removed and the broken backend running. It now treats a failed `up` as an unhealthy release and restarts the previous tag. Re-tested: the old release was healthy again about 13 s later.
2. **`preflight.sh` would have crashed on the VPS.** Its embedded Python used a quoting style that Python ≤ 3.11 rejects (Ubuntu 22.04 ships 3.10). Rewritten portably. The `UNINOTES_ORIGIN` check also wrongly rejected an explicit port.
3. **CI's secret scan was failing** on `main`. A test-only password from the legacy-import work (commit `5946cfd`) matched gitleaks' generic rule. Allow-listed by exact fingerprint, following the repository's existing convention. The full-history scan now reports **no leaks**.

---

## 4. Tests performed and results

All container tests ran against a **replica** of the VPS layout (`…/srv/UniNotes/{app,data,backups}`), built from a copy of the repository. It used a throwaway `.env` and secret, and loopback ports 3002/3003. The replica, its images, containers and data were deleted afterwards. **Your development database was never written:** its SHA-256 was identical before and after.

### 4.1 Application suites

| Check | Result |
|---|---|
| Backend: Prettier, ESLint, `tsc`, Vitest, build | ✅ **150/150** tests |
| Frontend: Prettier, ESLint, `tsc`, Vitest, build | ✅ **52/52** tests |
| Playwright E2E (isolated dev servers) | ✅ **15/15** |
| Playwright E2E **through the production stack** (edge Caddy with the real snippet → production containers) | ✅ **15/15** |
| `openapi.json` drift | ✅ unchanged |
| Gitleaks: full git history / files to be committed | ✅ no leaks / only allow-listed test fixtures |

### 4.2 Deployment configuration

| Check | Result |
|---|---|
| `compose config` (production defaults) | ✅ `name: uninotes`, `uninotes-backend`/`-frontend`, `127.0.0.1:3002`/`3003`, mounts under `/srv/UniNotes/...` |
| `compose.yaml` still valid | ✅ |
| ShellCheck (warnings and errors) on all scripts | ✅ clean |
| `caddy validate`: the snippet alone, and appended after the live Notes block | ✅ "Valid configuration"; `caddy fmt` reports no changes |
| The CI `deploy-config` compose assertion run locally | ✅ |
| Preflight positive run (replica) | ✅ all required checks passed |
| Preflight **negative** runs | ✅ FAILs on: `compose.yaml` selected (proxy service, `0.0.0.0:80/443`); a port without `127.0.0.1`; `.env` 644; reserved port 3001; data directory owned by root |

### 4.3 Runtime and security (through the real Caddy snippet, served as `https://localhost:8443`)

Deploy, then: both containers healthy; backend uid 1000 (`node`), frontend uid 65534; data files owned 1000:1000 in 0700 directories; only `127.0.0.1:3002/3003` listening; read-only root filesystems, `cap_drop ALL`, `no-new-privileges`, 512/64 MiB limits, `json-file` 10m×3, `restart: unless-stopped`; network `uninotes_default` only; no named data volumes.

**26/26 end-to-end checks passed:**

| Area | Checks |
|---|---|
| Sign-in | login, wrong password 401, logout, session invalid after logout |
| Cookies and headers | cookie `__Host-` + Secure + HttpOnly + SameSite; HSTS; no `Server` header; frontend CSP and `X-Frame-Options: DENY` |
| Access control | unauthenticated API 401; CSRF without token 403; foreign Origin 403; another user's note and attachment 404; anonymous download 401 |
| Notes | create an undated note, read, autosave PATCH, search |
| Attachments | image upload, served inline as `image/png` with `nosniff`; `.html` upload served as a **`text/plain` attachment with sandbox CSP**, bytes unchanged |
| Export and limits | note ZIP export includes assets; **Caddy rejects a 31 MB body with 413**; `/api/unknown` is a JSON 404 from the backend, not the SPA |

**Client-IP spoofing:** a login sent with `X-Forwarded-For: 6.6.6.6` was audited with the real client address. Spoofing doesn't work.

### 4.4 Backup, restore, deploy and rollback

| Scenario | Result |
|---|---|
| `backup.sh --local` | ✅ verified snapshot in `backups/local/<stamp>` (database, attachments, manifest) |
| Restore round trip | ✅ a note added after the backup was gone after restore; the pre-restore safety copy kept it; old sessions were invalidated |
| Upgrade, then `rollback.sh` | ✅ release 2 served, rollback served release 1; tags recorded correctly |
| Broken release (backend never healthy) | ✅ (after fix 1) automatic rollback to the last good tag, healthy; `deploy.sh` exits non-zero; `.last_good_tag` unchanged |
| Release with a schema migration | ✅ `deploy.sh` backed up **before** migrating, then applied it |
| Rollback to older code without restoring the database | ✅ **refused** ("database has 4 migrations but release … knows only 3"), nothing changed |
| `rollback.sh --to <old> --restore-db latest` | ✅ restored the pre-migration backup (current data preserved first); old release healthy; schema back to 3 migrations; data intact |

### 4.5 Moving your imported notes to the server (rehearsal)

1. `npm run backup` in Codespaces, with the output directed to the replica's backups folder. It only reads the dev database, and its checksum was unchanged.
2. `restore.sh` on the replica.

**Result:**
- `switchback` / Wesley present;
- **126 notes, 27 modules, 382 attachments (all 382 files present, owned 1000:1000)**;
- search index 126 rows;
- `integrity_check` ok, no foreign-key violations, 3/3 migrations;
- containers healthy.

MFA and recovery codes are not enrolled, so a **new** production `APP_SECRET_KEY` is safe.

### 4.6 Memory

| Measurement | Peak |
|---|---:|
| Backend image build | 587 MiB (41 s) |
| Frontend image build (Vite + Go/xcaddy stages) | 1,095 MiB overall; stages separately: Vite 1,009 MiB, Caddy compile 1,119 MiB (193 s) |
| Backend runtime: 3 uploads of the 5405×3901 image (each downscaled to 4096×2956) plus a full export, from the cgroup's exact high-water mark | **127 MiB** of 512 MiB |
| Frontend runtime | **15 MiB** of 64 MiB |

**Recommendation:** do not build on the droplet without swap. The VPS has about 1.3 GiB available and Notes has no memory limit, so the OOM killer could pick `notes-api`. Build in Codespaces and ship the images (`build-images.sh`, `ship-images.sh`, `deploy.sh --no-build`), or add 2 GiB swap first.

---

## 5. Outstanding risks

| Risk | Severity | Mitigation / owner |
|---|---|---|
| On-VPS image builds could trigger the OOM killer (and kill Notes) | High if done without swap | Build off-box (recommended) or add swap; `deploy.sh` warns |
| No off-site backup yet; DigitalOcean droplet backups unknown | High | Configure `RESTIC_*` (e.g. DigitalOcean Spaces) and/or enable Droplet Backups; store `APP_SECRET_KEY` and `RESTIC_PASSWORD` in a password manager |
| Rolling back across a migration needs a database restore, which loses changes made since the deploy | Medium (by design) | `rollback.sh` refuses without `--restore-db`; `deploy.sh` always backs up before migrating; the pre-restore copy keeps the newer data |
| Scripts were tested in Codespaces (Docker 29.8 / Compose 5.5.1), not on the VPS (Docker 29.1.3 / Compose 5.1.0, Ubuntu 22.04, bash 5.1, Python 3.10) | Low–medium | Only standard Compose features are used; Python code is 3.10-compatible; run `preflight.sh` first, which exercises most of the tooling |
| The containers have outbound internet access (the default bridge network; Docker can't publish ports from an `internal` network) | Low | The backend makes no outbound calls; no inbound exposure beyond loopback |
| The frontend image carries a self-compiled Caddy (CVE-patched); upstream fixes need manual pin bumps | Low | The CI Trivy scan flags fixable HIGH/CRITICAL issues; the container is loopback-only |
| `ship-images.sh` transfer size not measured | Low | gzip-compressed `docker save` of both images; expect a few hundred MB |
| Caddy access logs (`/var/log/caddy/university.access.log`) contain IPs and URLs | Low | Rotated (10 MiB × 5); credentials are redacted by Caddy by default |
| MFA not yet enabled for `switchback` | Medium | Enable it right after the first sign-in (checklist H) |
| Pre-existing VPS hygiene (Notes `.env` 0664, no Notes backups, root SSH login likely allowed) | Medium (Notes) | Out of scope; recommended as a separate change |

---

## 6. Required manual VPS actions

In order. Full commands are in [DEPLOYMENT.md §4](DEPLOYMENT.md#4-first-deployment-checklist).

1. *(Optional)* Take a droplet snapshot.
2. Namecheap: `A university → 178.62.99.141` (no AAAA). Wait for `dig` to resolve.
3. As `wesley`: create `/srv/UniNotes/data/{db,attachments}` and `/srv/UniNotes/backups` (uid 1000, mode 700); clone the repository to `/srv/UniNotes/app` and check out the release commit.
4. Create `.env` (mode 600) with a new `APP_SECRET_KEY`; run `./scripts/preflight.sh`.
5. Images: ship from Codespaces and run `./scripts/deploy.sh --no-build`, **or** 🔒 add 2 GiB swap and run `./scripts/deploy.sh`.
6. Bring your notes across: Codespaces `npm run backup` → `scp` → `./scripts/restore.sh <stamp>`.
7. 🔒 Append `deploy/Caddyfile.university`, `caddy validate`, `systemctl reload caddy`. Verify that Notes still returns 200.
8. Browser checks; enable MFA.
9. `backup.sh` and `restore.sh --verify-only`; install the two cron lines; configure off-site backups.
10. Confirm Notes is unaffected: same `notes-api` container ID and uptime, Notes Caddy block identical, nothing changed under `/srv/notes`.

---

## 7. Rollback and recovery considerations

| Layer | How | Effect on Notes |
|---|---|---|
| Release | `rollback.sh` (previous tag) or `--to <tag>`; images stay on the host, so no rebuild is needed. `deploy.sh` does this automatically when a release is unhealthy | None |
| Release + schema | `rollback.sh --to <tag> --restore-db latest`. `latest` is the pre-migration backup `deploy.sh` took. Refused without it when the database is ahead | None |
| Data | `restore.sh <stamp>`. The current data is preserved in `backups/pre-restore-<time>/`; `--verify-only` changes nothing | None |
| Caddy | Restore the Caddyfile backup, `validate`, `reload` (Caddy keeps the old configuration if a reload fails) | None |
| Remove UniNotes | `./scripts/compose.sh down`, remove the Caddy block, reload; keep `/srv/UniNotes/data` | None |
| Droplet loss | New droplet: clone, same `APP_SECRET_KEY` and `RESTIC_*`, `deploy.sh`, `restore.sh restic:latest` | — |
| Last resort | Droplet snapshot | Reverts Notes too |

**Safety properties:**
- No script references `/srv/notes`, `notes-api`, the project `app`, port 3001, or `/etc/caddy`.
- No script runs `docker system prune` or a bare `docker compose`.
- All state (data, backups, release tags) lives outside the git checkout.

---

## 8. Not testable from Codespaces

- Real DNS, Let's Encrypt issuance and the public HTTPS URL. A local Caddy with an internal certificate was used to emulate them.
- The host's systemd Caddy reload, `ufw` interaction, and `sudo` steps.
- The behaviour on the droplet's exact Docker/Compose/Ubuntu versions and its 1.9 GiB memory under real load.
- `ship-images.sh` over SSH to the VPS, and restic uploads to a real off-site bucket.

The repository changes are **not committed**. Commit them, together with the three VPS reports in `docs/`, before the first deployment.
