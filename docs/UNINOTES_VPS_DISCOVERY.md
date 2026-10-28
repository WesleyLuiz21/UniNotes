# UniNotes — VPS Discovery Report

**Host:** DigitalOcean Droplet, public IPv4 `178.62.99.141`
**Audit date:** 2026-10-28
**Audited as:** user `wesley` (uid 1000; groups `sudo`, `docker`). `sudo` requires a password, so root-only data could not be read.
**Scope:** read-only. Nothing was installed, cloned, restarted, reconfigured or modified. No secrets are reproduced here.

### Legend

| Tag | Meaning |
|---|---|
| ✅ **Verified** | Observed directly by command output during this audit |
| ❓ **Unverified** | Could not be read without root; needs `sudo` to confirm |
| ⚠️ **Assumption** | Inference, not directly observed |

---

## 1. Executive summary

| # | Finding | Status |
|---|---|---|
| 1 | Notes runs as **one Docker container (`notes-api`)** plus a **static React build served directly by Caddy**. | ✅ |
| 2 | **Caddy is installed on the host (systemd, apt package), not in Docker.** It proxies to apps via `127.0.0.1:<port>`, not via a Docker network. | ✅ |
| 3 | `/srv/notes` layout confirmed: `app/` (git repo), `db/` (SQLite bind mount), `frontend/` (static build), `_backup/`. | ✅ |
| 4 | Notes' Compose project is named **`app`** (derived from directory name) with network **`app_default`**. A second project in a directory named `app` would collide. | ✅ |
| 5 | **`university.wesleyldshub.dev` has no DNS record**, and there is no wildcard record. | ✅ |
| 6 | **No automated backups exist** for Notes data. Almost all Notes data lives in the SQLite **WAL file**, not the main `.db` file. | ✅ |
| 7 | **1 vCPU, 1.9 GiB RAM, no swap.** On-box image builds are a real out-of-memory risk. | ✅ |
| 8 | Ports `3002` and `3003` (and everything except those listed in §6) are free on loopback. | ✅ |
| 9 | The Notes README's documented architecture (`caddy_net` network, container-name proxying) **does not match** what is actually deployed. | ✅ |

---

## 2. Operating system and resources

| Item | Value | Status |
|---|---|---|
| Distribution | Ubuntu 22.04.5 LTS (Jammy) | ✅ |
| Kernel | 5.15.0-198-generic | ✅ |
| CPU | 1 vCPU, `DO-Premium-Intel` | ✅ |
| Memory | 1.9 GiB total; ~490 MiB used; ~1.3 GiB available | ✅ |
| Swap | **None configured** | ✅ |
| Disk | `/dev/vda1` ext4, 68 GB, 8.9 GB used (14%), 59 GB free | ✅ |
| Other mounts | `/boot/efi` (vfat, 105 MB); `vdb` 488 KB read-only (DigitalOcean config drive) | ✅ |
| Uptime / load | 11 days; load average 0.00 / 0.01 / 0.00 | ✅ |
| Pending reboot | No `/var/run/reboot-required` | ✅ |
| Unattended upgrades | Enabled (`Update-Package-Lists "1"`, `Unattended-Upgrade "1"`) | ✅ |
| Login-shell users | `root`, `wesley` | ✅ |

**Largest resident processes (excluding this audit session):** systemd-journald ~100 MB, notes-api `node` ~34 MB, dockerd ~33 MB, multipathd ~27 MB, snapd ~26 MB, caddy ~25 MB, fail2ban ~23 MB, containerd ~21 MB.

### Resource implications for UniNotes
- **Runtime is fine.** A small Express + SQLite backend (~50–120 MB) plus a static frontend server (~5–15 MB for nginx) fit comfortably.
- **Build time is the risk.** `npm ci` with native modules (e.g. `better-sqlite3`, which needs `python3 make g++` as Notes' Dockerfile shows) and a `vite build` can each peak at 500 MB–1 GB+. With no swap, the kernel OOM killer could terminate processes, potentially including `notes-api`. ⚠️ (based on typical Node build profiles, not measured here)
- Disk capacity is ample.

---

## 3. Docker infrastructure

| Item | Value | Status |
|---|---|---|
| Docker Engine / Client | 29.1.3 / 29.1.3 | ✅ |
| Compose | `docker compose` plugin v5.1.0. Legacy `docker-compose` binary **not installed** | ✅ |
| Storage driver / root | overlay2, `/var/lib/docker` | ✅ |
| `/etc/docker/daemon.json` | **Does not exist** (all defaults) | ✅ |
| Default log driver | `json-file` **with no rotation configured** | ✅ |

### 3.1 Containers

| Name | Image | Status | Ports | Restart | Healthcheck | Mem limit | User |
|---|---|---|---|---|---|---|---|
| `notes-api` | `app-notes-api` | Up 11 days | `127.0.0.1:3001->3001/tcp` | `unless-stopped` | **none** | **none** | root (no `USER` set) |

Only one container exists (running or stopped). ✅
The root-owned `node src/index.js` process (PID 1473) visible on the host is the `notes-api` container's process (confirmed via its systemd scope `docker-26c1b0c8….scope`). ✅

### 3.2 Compose projects

| Project | Config file | Working dir | Service |
|---|---|---|---|
| `app` | `/srv/notes/app/docker-compose.yml` | `/srv/notes/app` | `notes-api` |

✅ from `com.docker.compose.*` labels.

> ⚠️ **Collision risk:** The project name `app` came from the directory name, not an explicit `name:`. Any other compose file run from a directory called `app` would join the same project, could treat `notes-api` as an orphan, and `--remove-orphans` would delete it. UniNotes **must** declare an explicit, unique project name.

### 3.3 Networks

| Network | Driver | Members |
|---|---|---|
| `app_default` | bridge | `notes-api` |
| `bridge`, `host`, `none` | built-ins | — |

There is **no `caddy_net`** network, despite the Notes README instructing its creation. ✅

### 3.4 Volumes and images
- **Named volumes:** none. ✅
- **Notes persistence:** bind mount `/srv/notes/db` → `/data` (rw). ✅ The Dockerfile also declares `VOLUME ["/data"]`; the bind mount overrides it.
- **Images:** `app-notes-api:latest` (467 MB, in use), `backend-notes-backend:latest` (142 MB, 8 months old, **unused**), `node:20-alpine` (135 MB). `docker system df` reports 9 images total, including dangling layers. ✅

---

## 4. Existing Notes application

### 4.1 Directory layout ✅

```
/srv                              drwxr-xr-x wesley:wesley
├── notes/                        drwxr-xr-x wesley:wesley
│   ├── app/          (48 MB)     git repo: github.com/WesleyLuiz21/Notes-App-Final.git
│   │   ├── .env                  -rw-rw-r-- wesley:wesley   (keys: SESSION_SECRET, FRONTEND_ORIGIN, DOMAIN, DB_PATH)
│   │   ├── .env.example
│   │   ├── docker-compose.yml
│   │   ├── Caddyfile.example     (not the live config; describes a different design)
│   │   ├── backend/              Dockerfile: node:20-alpine + python3/make/g++, npm ci --omit=dev
│   │   └── frontend/             React 18 + Vite 5 source, with a local dist/ and node_modules/
│   ├── db/           (2.9 MB)    bind-mounted into notes-api at /data
│   │   ├── app.db                4 KB, root:root, mtime 2026-03-02
│   │   ├── app.db-shm            32 KB
│   │   └── app.db-wal            ~2.8 MB, mtime today (active)
│   ├── frontend/     (200 KB)    built static site served by Caddy (index.html + assets/, built 2026-03-05)
│   └── _backup/
│       └── app_2026-02-28_131728/backend/   one-off code copy only, no data
└── projects/
    ├── project2/{app,db}/        empty, root-owned
    └── project3/{app~,db~}/      empty, root-owned
```

### 4.2 Git deployment state ✅
- Branch `main`, working tree clean, origin `https://github.com/WesleyLuiz21/Notes-App-Final.git` (HTTPS).
- Last commit `1aa257f` on 2026-03-05. Container created 2026-03-05.
- **Deploy model (inferred ⚠️):** manual `git pull` → `docker compose up -d --build` for the API; the frontend is built (`vite build`) and its `dist/` copied to `/srv/notes/frontend`. There is no deploy script, CI, image registry or tagging.
- `gh` CLI is not installed; `git` is.

### 4.3 Notes runtime configuration ✅
- Compose sets `NODE_ENV=production`, `PORT=3001`, `DB_PATH=/data/app.db`, `env_file: ./.env`.
- Compose file uses obsolete `version: '3.8'` key (harmless warning in Compose v2+).
- Requests to `GET /` on 127.0.0.1:3001 and `GET /api/` via Caddy both return 404. This is expected: no root route is defined.

### 4.4 Persistent storage and SQLite state ✅
- `app.db` has not been modified since 2026-03-02, while `app.db-wal` is ~2.8 MB and updated today. **Essentially all Notes data is in the WAL file and has never been checkpointed into the main DB.**
- **Consequence:** copying only `app.db` (e.g. `cp app.db backup.db`) would lose nearly all data. Any backup must use SQLite's online backup API (`.backup` / `VACUUM INTO` / `better-sqlite3`'s `db.backup()`), or copy all three files while the app is stopped.
- `sqlite3` CLI is **not installed** on the host. ✅

### 4.5 Backups ✅
- **No user crontab**, no backup-related `/etc/cron.d` entries, no backup systemd timers.
- `/srv/notes/_backup/` holds only a February code snapshot.
- DigitalOcean droplet-level backups/snapshots: ❓ cannot be determined from inside the VM. Check the DigitalOcean control panel.

---

## 5. Caddy reverse proxy and HTTPS

| Item | Value | Status |
|---|---|---|
| Install type | apt package, systemd `caddy.service`, enabled, running since 2026-10-17 | ✅ |
| Version | v2.11.1 | ✅ |
| Process user | `caddy` | ✅ |
| Config | `/etc/caddy/Caddyfile` (root:root, 0644, last modified 2026-03-02) | ✅ |
| Config validity | `caddy validate` → **Valid configuration** | ✅ |
| Admin API | `127.0.0.1:2019` (default) | ✅ |
| Data dir (certs) | `/var/lib/caddy`, permission denied to `wesley` | ✅ / ❓ contents |
| Log dir | `/var/log/caddy` exists (caddy:caddy); live config has no `log` directive, so access logs are off | ✅ |

### 5.1 Live routing (verbatim structure, comments stripped)

```caddyfile
notes.wesleyldshub.dev {
    handle_path /api/* {
        reverse_proxy 127.0.0.1:3001
    }
    handle {
        root * /srv/notes/frontend
        file_server
        try_files {path} /index.html
    }
}
```

- Single site block; no global options block; no imports.
- `handle_path` **strips** `/api` before forwarding to Express.
- No custom security headers, compression or request-size limits are set.

### 5.2 HTTPS ✅
- Automatic HTTPS active. The current certificate is from Let's Encrypt (`CN=YE1`), valid 2026-10-25 → 2027-01-23 (renewal working).
- HTTP → HTTPS: `308 Permanent Redirect`.
- HTTP/2 and HTTP/3 (`alt-svc: h3`) advertised.

### 5.3 Implications
- Caddy reaches backends at **`127.0.0.1:<port>`**. UniNotes containers must publish to loopback ports and do **not** need to join any shared Docker network.
- Adding a new site block and running `systemctl reload caddy` is a graceful, zero-downtime config swap that leaves the Notes block untouched.
- The Caddyfile is root-owned, so editing it requires `sudo`.

---

## 6. Network ports ✅

| Address | Port | Owner |
|---|---|---|
| `*` | 80, 443 | Caddy |
| `0.0.0.0` / `[::]` | 22 | sshd |
| `127.0.0.1` | 2019 | Caddy admin API |
| `127.0.0.1` | 3001 | notes-api (docker-proxy) |
| `127.0.0.53` | 53 | systemd-resolved |
| `127.0.0.1` | 38559 | ❓ root-owned process, not identifiable without sudo (not the audit session) |

**Free for UniNotes:** `127.0.0.1:3002`, `127.0.0.1:3003` (and other unlisted ports).

---

## 7. DNS readiness ✅

| Record | Result |
|---|---|
| `wesleyldshub.dev` A | 178.62.99.141 |
| `notes.wesleyldshub.dev` A | 178.62.99.141 |
| `university.wesleyldshub.dev` A | **no record (NXDOMAIN / empty)** |
| Wildcard (`randomxyz123.wesleyldshub.dev`) | no record, so **no wildcard** |
| AAAA (any) | none; droplet has **no global IPv6 address** |
| CAA | none (Let's Encrypt is not restricted) |
| Nameservers | `dns1/dns2.registrar-servers.com` (**Namecheap** DNS) |

**Required before go-live:** an `A` record `university` → `178.62.99.141` at Namecheap. Do **not** add an AAAA record (no IPv6 on the droplet).

---

## 8. Security and permissions

### 8.1 Firewall and intrusion prevention
| Item | Value | Status |
|---|---|---|
| ufw | service **active** | ✅ |
| ufw rules | ❓ unreadable without sudo. Ports 80/443 are evidently reachable externally (Let's Encrypt issued a certificate on 2026-10-25) | ❓ |
| fail2ban | service **active**; jail config ❓ unreadable | ✅ / ❓ |

> ⚠️ **Docker bypasses ufw.** Ports published as `HOST:PORT` (without `127.0.0.1:`) are inserted into iptables ahead of ufw rules and become publicly reachable regardless of ufw. Notes correctly binds to `127.0.0.1`. UniNotes must do the same.

### 8.2 SSH
- `/etc/ssh/sshd_config` includes `sshd_config.d/*.conf` **at line 12, before its own directives**, so drop-ins take precedence (sshd uses the first value it reads). ✅
- `60-cloudimg-settings.conf`: `PasswordAuthentication no`. ✅
- Main file: `PermitRootLogin yes`, `PasswordAuthentication yes` (the latter is overridden by the drop-in). ✅
- `50-cloud-init.conf`: ❓ unreadable.
- **Effective `PermitRootLogin` is likely `yes` (key-only).** ⚠️ Confirm with `sudo sshd -T | grep -Ei 'permitrootlogin|passwordauthentication'`.

### 8.3 File permissions
| Path | Mode | Note |
|---|---|---|
| `/srv`, `/srv/notes`, `/srv/notes/app` | 0755 wesley | ✅ OK |
| `/srv/notes/app/.env` | **0664** wesley:wesley | ⚠️ group-writable and world-readable. Contains `SESSION_SECRET`. Recommend `0600`. |
| `/srv/notes/db` | 0755 wesley; DB files **root:root 0644** | ⚠️ DB is world-readable on the host |
| `/srv/notes/frontend` | 0775 wesley | ✅ OK (public content) |
| `/etc/caddy/Caddyfile` | 0644 root | ✅ OK |

### 8.4 Container hardening (Notes)
- Runs as root inside the container, with no healthcheck, no memory limit and no log rotation. ✅ These are observations; Notes must not be changed as part of this work.

---

## 9. Discrepancies between documentation and reality ✅

| Notes README / `Caddyfile.example` says | Reality |
|---|---|
| Create Docker network `caddy_net` | Does not exist |
| Caddy proxies `notes-api:3001` by container name | Impossible with host Caddy; live config uses `127.0.0.1:3001` |
| API on `api.notes.yourdomain.com` | API served at `notes.wesleyldshub.dev/api/*` (same origin) |
| Frontend on Netlify/Vercel or Caddy | Served by Caddy from `/srv/notes/frontend` |

**Conclusion:** the live, working pattern is **host Caddy → loopback-published container ports**, with same-origin `/api`. UniNotes should follow that pattern, not the README's.

---

## 10. Items requiring sudo to verify (optional, read-only)

```bash
sudo ufw status verbose
sudo ss -ltnp                       # identify owner of 127.0.0.1:38559
sudo sshd -T | grep -Ei 'permitrootlogin|passwordauthentication|pubkeyauthentication'
sudo fail2ban-client status
sudo ls -la /var/lib/caddy/.local/share/caddy/certificates/
```

DigitalOcean control panel: check whether **Droplet Backups** are enabled.
