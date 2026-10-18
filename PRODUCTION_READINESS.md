# UniNotes — Production Readiness & Security Audit

| | |
|---|---|
| **Date** | 2026-10-18 |
| **Commit audited** | `7a00acb`, plus the fixes listed in §3 (uncommitted at time of writing) |
| **Target** | DigitalOcean Droplet that **already hosts another Docker application** |
| **Toolchain** | Node v24.21.0, npm 11.19.0, Docker Engine 29.8.0, Docker Compose 5.5.1 |
| **Environment** | GitHub Codespaces. The production Docker stack was built and run locally under an isolated Compose project (`uninotes-prodcheck`) with throwaway data; everything was removed afterwards. |

---

## 1. Recommendation

### **NO-GO today. This becomes GO once the one blocking item (B1) is resolved; no code changes are needed.**

The application itself has **no open Critical or High findings**. Every security control listed in §5 was exercised against the running production stack and passed. Data survives restarts and rebuilds, and backup/restore (including full disaster recovery) was proven.

The blocker is specific to your Droplet: **it already runs another Docker application, and I could not inspect it.** UniNotes' default mode binds ports 80/443. If the other application owns them, UniNotes' proxy will not start. The other app would not be harmed, but UniNotes would be unreachable. Which of the three supported modes is correct depends on how that application is exposed, and one possible situation (an app binding 80/443 directly, with no reverse proxy) cannot be solved without changing it. That decision is yours.

### Blocking issues

| ID | Severity | Issue | What resolves it |
|---|---|---|---|
| **B1** | **High (blocking)** | Ownership of ports 80/443 on the Droplet is unknown, so the reverse-proxy mode (A, B or C) cannot be chosen yet. | Run `./scripts/preflight.sh` on the Droplet (read-only). Follow its recommendation and set `.env` accordingly. If 80/443 belong to an application **without** a reverse proxy, decide whether you accept adding one route to a shared proxy (which changes how that app is exposed), or use a different hostname/port. |

### Go-live gates (must pass on the Droplet during the first deployment; not verifiable from Codespaces)

| ID | Gate | How to check |
|---|---|---|
| G1 | A real certificate is issued for your domain (Option A), or your existing proxy serves valid TLS (Options B and C). | Open `https://<domain>`: valid padlock; `http://` redirects to `https://`. |
| G2 | Real visitor IPs reach UniNotes (per-IP login limits depend on this). | After signing in, **Settings → Security → Active sessions** must show your public IP, not `172.x`. |
| G3 | Two-factor authentication is enabled on your account. | Settings → Security. Store the recovery codes. |
| G4 | `APP_SECRET_KEY` and `RESTIC_PASSWORD` are stored in a password manager, and the first `./scripts/backup.sh --check` succeeds. | Script exit code 0 and "no errors were found". |
| G5 | The Droplet firewall allows only 22 (ideally your IP only), 80 and 443. | `ufw status`, or a DigitalOcean Cloud Firewall. |

---

## 2. Summary of results

| Area | Result | Evidence |
|---|---|---|
| Backend lint / typecheck / Prettier | ✅ pass | §4.1 |
| Frontend lint / typecheck / Prettier | ✅ pass (after fixing F5) | §4.1 |
| Backend unit/integration tests | ✅ **105 / 105** | §4.1 |
| Frontend unit/component tests | ✅ **47 / 47** | §4.1 |
| Playwright E2E (production build, dev harness) | ✅ **15 / 15** (desktop + mobile) | §4.2 |
| Playwright E2E against the **production Docker stack over HTTPS** | ✅ **13 / 13** | §4.2 |
| Production Docker images build | ✅ backend 453 MB, frontend 181 MB, caddy 163 MB | §4.3 |
| Image CVE scan (Trivy, HIGH/CRITICAL with a fix available) | ✅ **0 / 0 / 0** | §4.3 |
| `npm audit` (production dependencies) | ✅ 0 vulnerabilities (both) | §4.4 |
| Secret scan (gitleaks, full git history) | ✅ no leaks (2 test-only keys allowlisted) | §4.5 |
| Tracked `.env` files | ✅ none ever committed (only `.env.example` templates) | §4.5 |
| Live security checks (auth, sessions, CSRF, access control, uploads, headers, IP spoofing) | ✅ **51 / 51** | §5 |
| Live MFA checks | ✅ **13 / 13** | §5 |
| Data persistence across 8 lifecycle operations | ✅ identical fingerprint every time | §6 |
| Backup, restore, offsite disaster recovery, tamper detection | ✅ all pass | §7 |
| **Coexistence with another Docker application** (simulated) | ✅ other app untouched through every UniNotes operation | §8 |
| Placeholders / stubs / broken API wiring | ✅ none found | §9 |

---

## 3. Findings

Severity scale: **Critical** = exploitable now with severe impact; **High** = serious risk or blocks deployment; **Medium** = meaningful weakness that needs specific conditions; **Low** = hardening, hygiene or limited impact. "Fixed" means fixed **and** re-verified in this audit.

### Fixed during this audit

| ID | Severity | Finding | Fix | Verification |
|---|---|---|---|---|
| F1 | **High** | **Client IP spoofing behind an existing proxy (Options B and C).** Caddy took the *leftmost* `X-Forwarded-For` entry. Most existing proxies (nginx `$proxy_add_x_forwarded_for`, Traefik) *append* to that header, so a visitor could send `X-Forwarded-For: 6.6.6.6` and be recorded as `6.6.6.6`. That bypasses per-IP login limits and forges audit-log IPs. This is the likely mode on a shared Droplet. | `trusted_proxies_strict` in `docker/Caddyfile`: right-to-left parsing that skips only trusted proxies. | Before: `XFF '6.6.6.6, 198.51.100.7' -> recorded 6.6.6.6`. After: `-> recorded 198.51.100.7`, also for `6.6.6.6, 198.51.100.7, 172.20.0.9`. Option A re-checked: spoofed headers ignored. |
| F2 | **Medium** | The **edge Caddy (the only internet-facing process) ran as root (uid 0)**, with `CAP_NET_BIND_SERVICE`. | Runs as uid **1001** with **no capabilities**. Ports 80/443 are bound via the namespaced sysctl `net.ipv4.ip_unprivileged_port_start=0`. Volume ownership is set in the image. | `id` → `uid=1001`; `capAdd=[] capDrop=[ALL]`. HTTPS mode on a **fresh** volume issued a certificate (internal CA), served HTTP/2 + HSTS, refused TLS 1.0/1.1, and redirected HTTP→HTTPS (308). |
| F3 | **Medium** | **Production accepted a placeholder or trivial `APP_SECRET_KEY`** (e.g. the `Backend/.env.example` value `change-me-…`, or `aaaa…`). This key encrypts MFA secrets and keys recovery-code hashes. | `assertStrongSecret()`: in production, refuse known placeholders and keys with fewer than 16 distinct characters. | Before: both `ACCEPTED`. After: unit tests `rejects placeholders and low-entropy keys` / `accepts a generated key` pass. |
| F4 | **Medium** | **No working way to run behind a *containerised* existing proxy.** Option B binds to `127.0.0.1`, which another container cannot reach. | New `compose.existing-proxy.yaml` (Option C): publishes **no host ports** and joins the existing proxy's network under an alias. New read-only `scripts/preflight.sh` detects the situation. README updated. | §8: full lifecycle behind a stand-in nginx proxy; UniNotes `published host ports: []`; the other app was unchanged. |
| F5 | Low | `Frontend/e2e/core.spec.ts` failed `prettier --check`, which would fail CI. | Formatted. | `prettier --check` exit 0 in both projects. |
| F6 | Low | ShellCheck warnings (unused loop variable; unchecked `cd`). | Fixed. | `shellcheck -S warning scripts/*.sh` exit 0. |
| F7 | Low | No secret scanning in CI; gitleaks flags two fixed test-only keys. | `.gitleaksignore` for those two fingerprints; `secrets` job added to CI. | `gitleaks git` → "no leaks found". |

### Open (accepted, or for you to action)

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| B1 | **High (blocking)** | Port and proxy situation on the Droplet unknown. See §1. | Run `scripts/preflight.sh` on the Droplet and choose a mode. |
| O1 | Medium | **Not verifiable here:** real Let's Encrypt issuance and real client-IP preservation on DigitalOcean (IPv6 or userland-proxy can hide client IPs). | Go-live gates G1 and G2. |
| O2 | Medium | **Memory on a shared Droplet.** UniNotes is capped at about 770 MiB (backend 512 + frontend 128 + caddy 128). On a 1 GB Droplet that already runs an app, this could squeeze it. | The preflight reports available memory. Use ≥2 GB, or add swap. The caps mean UniNotes cannot take more than this. |
| O3 | Low | 43 HIGH CVEs in Debian 13 base utilities (`util-linux`, `ncurses`, `perl-base`, `libsystemd`) with **no fix published yet**. The Node process doesn't use them, nothing exposes them, and the container is non-root and read-only. | Redeploy monthly to pick up fixes. CI fails on any *fixable* HIGH/CRITICAL. |
| O4 | Low | 4 moderate advisories in `drizzle-kit`'s bundled esbuild (dev server). It's a dev-only migration generator and is never in an image. | Watch for a drizzle-kit update. |
| O5 | Low | The edge and frontend use a **self-built Caddy 2.11.7** (patched Go 1.26.9 / x/net 0.60.0), because the official image still ships known DoS CVEs. Pins must be maintained by hand. | When an official image scans clean, switch back (see `docker/caddy/Dockerfile`). |
| O6 | Low | Rate-limit and throttle state is in memory: it resets on backend restart. During a large distributed login flood, *new* sign-ins can receive a short 503 (deliberate load shedding). Existing sessions are unaffected. | Accepted for a single-user, single-instance app. |
| O7 | Low | The import dialog's client-side size check is hard-coded to 2 MB and doesn't follow `MAX_IMPORT_MB`. The server enforces the real limit, so this is cosmetic. | Only matters if you raise `MAX_IMPORT_MB`. |
| O8 | Low | `docker compose down -v` doesn't remove `<project>_restic_cache`, because it belongs to a profile-only service. It holds only restic's local cache. | Remove it manually if you ever want a fully clean slate. |

No Critical findings were identified.

---

## 4. Build, test and audit results (commands executed)

### 4.1 Static checks and unit tests

```bash
cd Backend  && npm ci && npm run lint && npm run typecheck && npx prettier --check . && npm test && npm run build && npm run openapi
cd Frontend && npm ci && npm run lint && npm run typecheck && npx prettier --check . && npm test && npm run build
```

| Project | lint | typecheck | prettier | tests | build |
|---|---|---|---|---|---|
| Backend | exit 0 | exit 0 | exit 0 | **105 passed (9 files)** | exit 0; `openapi.json` up to date |
| Frontend | exit 0 | exit 0 | exit 1 → fixed (F5) → exit 0 | **47 passed (9 files)** | exit 0 |

The final regression run after all fixes: Backend `lint=0 typecheck=0 prettier=0 test=0 | Tests 105 passed`; Frontend `lint=0 typecheck=0 prettier=0 test=0 | Tests 47 passed`.

### 4.2 End-to-end (Playwright)

```bash
cd Frontend && npx playwright test                       # isolated backend + production build
E2E_BASE_URL=https://localhost:8443 E2E_IGNORE_HTTPS_ERRORS=1 E2E_USER=… E2E_PASSWORD=… \
  npx playwright test --project=desktop -g "<13 flows>"  # against the production Docker stack (HTTPS)
```

- **Dev harness: 15 passed.** Login, create module, create/edit/preview note, paste image, autosave and reload, search, calendar, export, import (with duplicate detection), restore revision, delete and restore, conflict handling, theme, logout, CSP-violation check, mobile viewport.
- **Production stack over HTTPS: 13 passed.** The same flows, with `Secure` / `__Host-` cookies over TLS. Version restore was excluded, because production snapshots every 10 minutes; it is covered by the dev-harness run.

### 4.3 Production images

```bash
docker compose config -q          # "compose config valid"
docker compose build              # exit 0 (37 s)
docker run aquasec/trivy:0.67.2 image --scanners vuln --severity HIGH,CRITICAL <image>
```

| Image | Size | Fixable HIGH/CRITICAL | Unfixed upstream |
|---|---|---|---|
| backend (`node:24-trixie-slim`, npm removed) | 453 MB | **0** | 43 HIGH (O3) |
| frontend (static SPA on self-built Caddy) | 181 MB | **0** | 0 |
| caddy (edge, self-built Caddy, non-root) | 163 MB | **0** | 0 |

### 4.4 Dependency audits

```bash
npm audit --omit=dev   # Backend: found 0 vulnerabilities | Frontend: found 0 vulnerabilities
npm audit              # Backend: 4 moderate, all drizzle-kit → esbuild (dev only, O4) | Frontend: 0
```

### 4.5 Secrets and tracked files

```bash
git ls-files | grep -iE '(^|/)\.env|secret|\.pem$|\.key$|\.db$'   # .env.example, Backend/.env.example only
git log --all --diff-filter=A --name-only | grep -i '\.env'       # only the two .env.example files, ever
docker run zricethezav/gitleaks:v8.28.0 git /repo                 # 2 hits: fixed test keys → allowlisted → "no leaks found"
docker run zricethezav/gitleaks:v8.28.0 dir /repo                 # extra hits only in git-ignored .env files (expected)
```

- No real credentials are tracked or present in history.
- The `.env.example` files contain placeholders only. The root template's `APP_SECRET_KEY` is empty, so Compose fails closed ("required variable APP_SECRET_KEY is missing").
- `.env` is git-ignored and created with mode 600.

---

## 5. Security review: live verification

Two scripts were run against the production stack in **HTTPS mode**: a 51-check HTTP script and a 13-check Python MFA script. A second account was created with `create-user.js --additional` purely to test isolation. Everything below was **observed**, not inferred from code.

### Authentication and sessions
| Check | Result |
|---|---|
| Unknown user vs wrong password → identical responses | PASS |
| Cookie: `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain` | PASS (6 checks) |
| Logout revokes server-side; a replayed (stolen) cookie gets 401 | PASS |
| Logout sends `Clear-Site-Data: "cache"` | PASS |
| 11th bad login from one source → 429, despite rotating `X-Forwarded-For` | PASS |
| Per-IP login limiter (10 failures / 15 min) | Covered by unit tests (`auth.test.ts`, `hardening.test.ts`). Not separately measured live in this audit. |
| Setup command refuses a second account without `--additional`; never overwrites | PASS |

### MFA (TOTP)
| Check | Result |
|---|---|
| Setup requires the current password; wrong enrolment code rejected | PASS |
| After enabling: password alone gives `mfa_required` with no user data; the pending session cannot read data | PASS |
| 5th wrong code discards the pending sign-in (`MFA_ATTEMPTS_EXCEEDED`) | PASS |
| Recovery code signs in; the same code cannot be reused | PASS |
| Disabling requires password plus a valid code | PASS |

### CSRF and CORS
| Check | Result |
|---|---|
| POST without token / with wrong token → 403 | PASS |
| Foreign `Origin` with a **valid** token → 403 | PASS |
| `Sec-Fetch-Site: cross-site` → 403; classic HTML form login from a foreign origin → 403 | PASS |
| Same-origin POST with token → 201 | PASS |
| No `Access-Control-Allow-*` headers for a foreign origin | PASS |

### Access control
| Check | Result |
|---|---|
| **50 / 50** protected operations from `openapi.json` return 401 anonymously | PASS |
| A second user gets **404** for the owner's note, versions, attachments list, module, attachment metadata and content, all 3 exports, delete, archive and PATCH | PASS (13 checks) |
| A second user's search returns nothing of the owner's; they cannot upload into the owner's note; the owner's content is unchanged | PASS |

### File uploads
| Check | Result |
|---|---|
| SVG, HTML renamed `.png`, and an executable → 415 | PASS |
| 26 MB upload → 413 | PASS |
| Path in filename stripped (`../../etc/evil.pdf` → `evil.pdf`) | PASS |
| PDF served `Content-Disposition: attachment`, with `nosniff` and a sandboxed CSP | PASS |
| No direct web access to storage (only the SPA shell is returned) | PASS |

### XSS
- The frontend CSP forbids inline and remote script, `object-src 'none'` and `frame-ancestors 'none'` (verified live). API responses are JSON with `nosniff` and `no-store` (verified live).
- Renderer: 14 payload classes are neutralised (unit tests). Rich content renders with **zero CSP violations** in a real browser against the production stack (E2E `csp.spec.ts`).

### Transport
- TLS 1.0/1.1 refused; TLS 1.2/1.3 accepted; HTTP/2; HSTS `max-age=31536000; includeSubDomains`.
- HTTP→HTTPS 308. Caddy's admin API disabled. Slowloris protection: `read_header_timeout` 10 s (in config).

### Code review notes (no new issues)
Session tokens are 256-bit, stored only as SHA-256 hashes, with idle/absolute expiry and rotation on privilege change. Passwords use Argon2id (64 MiB, t=3) through a bounded queue. All SQL is parameterised (Drizzle `sql` templates) and FTS input is quoted per term. Every query is scoped by `user_id`. Uploads are content-sniffed, images re-encoded (EXIF stripped), and storage keys are random and path-checked. Markdown is rendered without raw HTML, sanitised before KaTeX, Mermaid is isolated in an `<img>`, and lint forbids `dangerouslySetInnerHTML`.

---

## 6. Docker Compose review and persistence

### Networking, ports, volumes and security settings (inspected live)

```bash
docker port <container>; ss -ltnu; curl 127.0.0.1:3000 / :8080
docker network inspect …; docker inspect -f '{{.Config.User}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} …'
```

| Item | Observed |
|---|---|
| Published ports | Only `caddy`, on the configured bind address. `backend`: none. `frontend`: none. |
| Backend/frontend reachable from host | No (`curl 127.0.0.1:3000` / `:8080` → unreachable) |
| `internal` network | `internal=true`; the backend has **no internet egress** (`fetch https://example.com` → `EAI_AGAIN`) |
| Users | backend `uid=1000`, frontend `uid=65534`, caddy `uid=1001` (after F2) |
| Root filesystem | read-only (all three) |
| Capabilities | `CapDrop=[ALL]`, `CapAdd=[]` (all three) |
| Other | `no-new-privileges:true`; not privileged; no Docker socket mount; no `network_mode: host`; no fixed subnets; `restart: unless-stopped`; memory caps 512/128/128 MiB; health checks on backend and frontend |
| Volumes | Named, project-prefixed: `db`, `attachments`, `backups`, `caddy_data`, `caddy_config` |

### Persistence test

A fingerprint was taken after every step: row counts, a hash of all note content, a hash of every attachment file, and `PRAGMA integrity_check`.

```
## baseline                                                {"users":2,"notes":1,"modules":1,"attachments":2,"files":2,"contentHash":"d4fc54b5281cd1d9","filesHash":"4e1a8c2d8834a92f","integrity":"ok"}
## docker compose restart                         exit=0   identical
## docker compose restart backend                 exit=0   identical
## docker compose down && docker compose up -d    exit=0   identical
## docker compose up -d --build --force-recreate  exit=0   identical
## ./scripts/deploy.sh backend                    exit=0   identical
## ./scripts/deploy.sh frontend                   exit=0   identical
## ./scripts/deploy.sh                            exit=0   identical
distinct fingerprints across all steps: 1
```

---

## 7. Backup and restore (isolated test data)

| Step | Command | Result |
|---|---|---|
| Backup + offsite + check | `./scripts/backup.sh --check` | exit 0. Local backup verified; restic snapshot saved; retention 30/8/6 applied; `check` found no errors. |
| Backup contents | inspected | `sessions in backup: 0`; password hashes are Argon2id; files `uninotes.db`, `manifest.json`, `attachments/` |
| Change data | added a note, deleted an attachment row and file | fingerprint changed |
| Verify only | `./scripts/restore.sh latest --verify-only` | exit 0, "Backup OK", **live data unchanged** |
| Local restore | `./scripts/restore.sh <name> --yes` | exit 0. Fingerprint **identical to the original**. Pre-restore safety copy kept. |
| **Disaster recovery** | `docker compose down -v` (test project only) → `./scripts/deploy.sh` (empty) → `./scripts/restore.sh restic:latest --yes` | exit 0. Fingerprint **identical to the original**. Owner sign-in → 200. |
| Tamper detection | appended junk to a backup's DB, then restore | exit 1, `Database checksum mismatch`; live data untouched; backend still running |

Important: a restore on a new server needs the **same `APP_SECRET_KEY`** for MFA to keep working, and `RESTIC_PASSWORD` to decrypt the offsite backup.

---

## 8. Coexistence with the existing Docker application

A stand-in for your existing application was run as a separate Compose project (`otherapp`): an nginx reverse proxy owning the front port, an app container, and its own data volume. UniNotes was deployed in **Option C** behind that proxy, with one route added to the stand-in proxy.

**Static review of `scripts/*.sh` and `compose.yaml`:** every Docker call goes through the project-scoped `docker compose`. There is no `system prune`, no global `rm`/`kill`, no host networking, no `container_name`, no fixed subnet, and no firewall or host-config changes.

```
## ./scripts/deploy.sh                exit=0
UniNotes published host ports: []
UniNotes via existing proxy: 200 | SPA: 200 | login: 200 | authenticated API: 200
## docker compose restart             exit=0
## ./scripts/backup.sh --local        exit=0
## ./scripts/restore.sh latest --yes  exit=0
## ./scripts/deploy.sh backend        exit=0
## ./scripts/deploy.sh frontend       exit=0
## docker compose down / up -d        exit=0 / exit=0
PASS: existing application completely unchanged (containers not restarted, same IDs, data, network, ports)
```

The other app's container IDs, `StartedAt`, restart counts (0), volume, network ID, content hash, response and published port were identical before and after. That run also uncovered F1, which is now fixed.

**`scripts/preflight.sh`** (read-only) reports: Docker/Compose versions; project-name collisions; who owns ports 80, 443 and the configured ports; containerised and host reverse proxies; available memory and disk; firewall status. It ends with an Option A/B/C recommendation. It was run here and correctly identified the stand-in proxy.

---

## 9. Incomplete features, placeholders and API wiring

```bash
grep -rniE "TODO|FIXME|XXX|HACK|not implemented|coming soon|lorem|dummy data|mock data" Backend/src Backend/scripts Frontend/src   # (none)
grep -rn "console.log" Backend/src Frontend/src                                                                                   # (none)
# Every api.* call / '/api/…' literal in Frontend/src matched against Backend/openapi.json
```

- **43 frontend call sites**, all matching real backend routes. Two showed as "unmatched" only because their paths are built dynamically (`/${action}` = archive, unarchive or restore; `${archived ? 'archive' : 'unarchive'}`), and all of those routes exist.
- Backend routes the UI doesn't call directly are intentional: health, `openapi.json`, `GET /settings/account` (account data comes with the session), and attachment content (reached through URLs returned by the API).
- Feature coverage is exercised end-to-end by the Playwright suite (§4.2). No placeholder screens or dummy buttons were found.

---

## 10. Changes made during this audit

| File | Change |
|---|---|
| `docker/Caddyfile` | `trusted_proxies_strict` (F1) |
| `docker/caddy/Dockerfile`, `compose.yaml` | Non-root Caddy (uid 1001), no capabilities, `ip_unprivileged_port_start` sysctl (F2) |
| `Backend/src/config.ts`, `Backend/test/unit.test.ts` | Reject weak/placeholder `APP_SECRET_KEY` in production, plus tests (F3) |
| `compose.existing-proxy.yaml` (new), `scripts/preflight.sh` (new), `README.md` | Option C and read-only preflight (F4) |
| `Frontend/e2e/core.spec.ts` | Prettier (F5) |
| `scripts/_common.sh`, `scripts/preflight.sh` | ShellCheck fixes (F6) |
| `.gitleaksignore` (new), `.github/workflows/ci.yml` | Secret scanning in CI (F7) |
| `Frontend/playwright.config.ts` | Opt-in `E2E_IGNORE_HTTPS_ERRORS` for testing HTTPS stacks with a local CA |
| `docs/SECURITY.md` | Updated for F1–F3 |

**Not done, on purpose:** nothing was committed or pushed. All test containers, volumes, images, the audit `.env` and the temporary Restic repository were removed. In Codespaces only, a temporary firewall rule was needed so containers could talk to each other (a known Codespaces quirk); it was removed afterwards and is not needed on a normal VPS.

---

## 11. Deployment steps for your Droplet

```bash
git clone <repo> /opt/UniNotes && cd /opt/UniNotes
./scripts/preflight.sh                        # read-only → choose Option A, B or C (resolves B1)
cp .env.example .env && chmod 600 .env
openssl rand -base64 48                       # → APP_SECRET_KEY (save in password manager)
#   Edit .env: COMPOSE_PROJECT_NAME (unique on this host), UNINOTES_ORIGIN=https://<domain>, the chosen
#   option's settings, UNINOTES_TRUSTED_PROXIES (Option A: 127.0.0.1/32; B/C: only the proxy's
#   address/network), RESTIC_*.
./scripts/deploy.sh
docker compose run --rm -it backend node dist/scripts/create-user.js
#   Sign in → enable MFA (G3) → check the session IP in Settings → Security (G2) → check TLS (G1)
./scripts/backup.sh --check                   # G4, then add the cron entries from README "Backups"
```
