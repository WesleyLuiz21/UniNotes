# UniNotes security checklist

Status of each control in V1, where it is implemented, and how it is verified. The design target is OWASP ASVS Level 2 for a single-user, self-hosted application.

## Threat model (summary)

- **Assets:** private lecture notes, attachments, account credentials and MFA secrets.
- **Adversaries:** internet attackers (credential stuffing, XSS/CSRF, upload abuse), a malicious web page visited by the signed-in user, and anyone who obtains a copy of a backup or the database file.
- **Out of scope:** an attacker with root on the VPS (they can read `.env` and memory). Mitigation there is host hardening, not application code.

## Authentication and accounts

| Control | Implementation | Verified by |
|---|---|---|
| No public registration or recovery endpoint | Accounts are created only by `scripts/create-user.ts` and reset only by `scripts/reset-password.ts`, both run on the server shell | `auth.test.ts`, which iterates over every route |
| Setup command is safe to re-run | Exits without changes if any account exists or the identifier is taken | Manual run during development |
| Argon2id password hashing | `@node-rs/argon2`, m=64 MiB, t=3, p=1 (`src/lib/password.ts`) | `auth.test.ts` |
| Password policy | At least 12 characters, at most 256, must not contain the username | `settings.routes.ts`, CLI |
| No user enumeration | Identical error for unknown user and wrong password; a dummy hash equalises timing | `auth.test.ts` |
| Brute-force protection | Per-IP limiter (failed attempts) and a hard block per (IP, account). Account-wide failures from many IPs only add a delay (up to 5 s), so attackers cannot lock the owner out. Five wrong MFA codes discard the pending sign-in. Argon2 runs through a bounded queue (2 active, 16 waiting; excess gets 503) | `auth.test.ts`, `hardening.test.ts` |
| TOTP MFA (optional) | RFC 6238 (SHA-1, 6 digits, ±1 step), with replay protection via an atomic last-used-step update | RFC test vectors and replay test |
| MFA secret at rest | AES-256-GCM, key derived with HKDF from `APP_SECRET_KEY` | `unit.test.ts`, plus a test that the database contains no plaintext secret |
| Recovery codes | 10 single-use codes stored only as keyed HMAC-SHA256 | `auth.test.ts` |
| Re-authentication for sensitive changes | Changing password, enabling/disabling MFA, regenerating codes, or changing username/email requires the current password (and a second factor if MFA is on) | `auth.test.ts` |

## Sessions

| Control | Implementation |
|---|---|
| Random tokens | 256-bit `crypto.randomBytes` |
| Hashed at rest | The DB stores only SHA-256(token), so a leaked database cannot be replayed as a session |
| Cookie flags | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `__Host-` prefix in production |
| Expiry | 7-day sliding idle timeout and 30-day absolute lifetime. MFA-pending sessions last 10 minutes |
| Rotation | A new token is issued on login, after MFA and on password change. Any existing session is dropped at login (no session fixation) |
| Revocation | Logout, logout-all, per-session revoke in Settings, and revoke-all on password change or MFA enable |
| No tokens in JS storage | The session cookie is HttpOnly. The CSRF token lives in memory only. `localStorage` holds just the theme preference |

## Client IP integrity

Rate limits and the audit log depend on the client IP, so it must not be spoofable:

- The edge Caddy trusts nobody's `X-Forwarded-For` by default (`UNINOTES_TRUSTED_PROXIES=127.0.0.1/32`). With `trusted_proxies_strict` it parses the header right-to-left, skipping only trusted proxies, so an appending upstream proxy cannot be abused. It then **replaces** the header with the IP it determined (`header_up X-Forwarded-For {client_ip}`).
- The backend trusts exactly **one** proxy hop (`TRUST_PROXY=1`), so it reads that value and nothing else.
- Behind an existing proxy (Option B), list only that proxy's address in `UNINOTES_TRUSTED_PROXIES`.

## Request security

| Control | Implementation |
|---|---|
| CSRF | Origin and `Sec-Fetch-Site` checks against `APP_ORIGIN`, plus a per-session synchronizer token in `X-CSRF-Token`, plus SameSite cookies (`middleware/csrf.ts`) |
| CORS | No CORS headers at all. The app is same-origin, so browsers block cross-origin reads |
| Authorisation | Every route declares `auth` (default on) in `defineRoute`. Every query is scoped by `user_id`, and other users' resources return 404 |
| Input validation | Zod schemas for params, query and body on every route; date-only strings are validated as real calendar dates |
| Body limits | Anonymous JSON 16 KB; signed-in JSON 2 MB; upload 10/25 MB (configurable); import 2 MB; Caddy hard cap 40 MB. Authentication is checked **before** any multipart body is read |
| Anonymous traffic | 300 requests per 5 minutes per IP across the API (signed-in traffic exempt). Caddy timeouts: 10 s to send headers (slowloris), 5 min per body, 2 min idle |
| Error handling | Central handler. Unknown errors become a generic 500; no stack traces or paths are returned; JSON parse errors are sanitised |
| Security headers | API: `default-src 'none'; sandbox` CSP, `nosniff`, `no-referrer`, `DENY` framing, COOP/CORP, `Cache-Control: no-store`. SPA: strict CSP (below), Permissions-Policy and HSTS at the edge |
| SQL injection | Drizzle query builder and `sql` tagged templates only; no string-concatenated SQL |
| FTS query injection | User search text is tokenised and every term quoted, so FTS operators and column filters are inert |
| Health endpoint | Returns only `ok` and database reachability |

### Frontend Content-Security-Policy

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none';
form-action 'self'; frame-ancestors 'none'; frame-src 'none'
```

No inline scripts (the theme bootstrap is an external file), no `eval`, and no remote origins. `'unsafe-inline'` applies to styles only, because CodeMirror, KaTeX and Shiki set inline styles. An E2E test confirms that rich notes render without CSP violations.

## Markdown and XSS

| Control | Implementation |
|---|---|
| Raw HTML disabled | `react-markdown` with `skipHtml`; no `rehype-raw` |
| Sanitisation | `rehype-sanitize` with GitHub's allow-list (tightened), applied **before** KaTeX |
| URL policy | `safeUrl` allows relative, `http(s)` and `mailto` links, and raster `data:image/*` images only. Control characters are stripped before checking the scheme |
| KaTeX | `trust: false` (no `\href` or `\html*`), with expansion and size limits |
| Mermaid | `securityLevel: 'strict'`, HTML labels off. The SVG is shown through an `<img>` data URI, so it cannot run script even if a sanitiser bug existed |
| Code highlighting | Shiki output is converted HAST → React elements, never an HTML string |
| Search snippets | The server marks matches with control characters and the client builds `<mark>` elements; no HTML is parsed |
| Remote images | Not loaded (blocked by CSP and replaced with a link), which prevents tracking pixels |
| Lint guard | ESLint forbids `dangerouslySetInnerHTML` anywhere in the frontend |
| Tests | 14 XSS payload classes in `MarkdownPreview.test.tsx`, plus URL-policy and highlight tests |

## Uploads and attachments

| Control | Implementation |
|---|---|
| Content validation | The file type is sniffed from the bytes (`file-type`); the client's MIME type and file extension are ignored |
| Allowed types | PNG, JPEG, WebP (images) and PDF. SVG, HTML, executables and everything else are rejected |
| Image re-encoding | `sharp` decode → re-encode. This strips EXIF/GPS metadata and appended payloads, applies a 4096 px cap, and has a decompression-bomb pixel limit |
| Private storage | Files sit in a volume outside any web root, are named with a random 192-bit key, and are written atomically with mode `0600` |
| Path traversal | Storage keys are regex-validated and the resolved path must stay inside the attachments directory |
| Ownership | Every read, list and delete checks `user_id`. Uploads require a note you own |
| Download headers | Exact `Content-Type`, `nosniff`, `sandbox` CSP, RFC 6266 filenames. PDFs are always sent as attachments (never inline) |
| Cleanup | Permanently deleting a note removes its unreferenced files after the DB transaction commits |

## Data integrity

- SQLite runs with WAL, `foreign_keys=ON`, `busy_timeout=5000`, and transactions for every multi-step change.
- Optimistic concurrency uses note revisions. A conflict returns 409 with the server copy and never overwrites silently.
- Version history: restores create new revisions. Imports never overwrite (duplicates are detected).
- Migrations are explicit only, and preceded by a backup and followed by an integrity check.

## Secrets and operations

- In production the backend refuses placeholder or low-entropy `APP_SECRET_KEY` values.
- `.env` holds placeholders in the template only, and is git-ignored. `deploy.sh` warns if it is not `chmod 600`.
- Logs redact cookies, authorisation and CSRF headers, passwords, codes, tokens and secrets.
- Backups contain no sessions and no plaintext secrets. The offsite copy is encrypted by restic, and backups are verified with checksums.
- All three containers run as non-root (backend uid 1000, frontend 65534, Caddy 1001) with a read-only root filesystem, `cap_drop: ALL` and **no added capabilities**, plus `no-new-privileges`, resource limits and internal-only networks. Caddy binds 80/443 through the namespaced sysctl `net.ipv4.ip_unprivileged_port_start=0`. Only the reverse proxy publishes ports.
- `npm audit --omit=dev` reports 0 vulnerabilities for both packages. CI runs it on every push. A transitive `katex` advisory (GHSA-238p-pmpm-9mq7) is resolved with an npm override to KaTeX 0.19.

## Recommendations for the operator

1. Enable two-factor authentication right after creating the account, and store the recovery codes.
2. Keep `APP_SECRET_KEY` and `RESTIC_PASSWORD` in a password manager.
3. Keep the VPS patched. Allow only SSH and 80/443 through the firewall, and use key-only SSH.
4. Run `./scripts/backup.sh --check` weekly, and occasionally `restore.sh --verify-only`.
5. Run `npm audit` and rebuild images periodically to pick up base-image security updates (`./scripts/deploy.sh`).

## Penetration test (2026-10-18)

Attacks run against the full production Docker stack, before and after hardening:

| # | Attack | Before | After |
|---|---|---|---|
| A1 | Spoof `X-Forwarded-For` to dodge per-IP login limits and forge audit-log IPs | **Worked**: attacker-chosen IPs were recorded | Spoofed headers ignored; the real peer IP is recorded |
| A2 | Make 10 bad logins so the owner gets locked out | **Worked**: the correct password was refused for 15 min, repeatable forever | The block is per (IP, account) only; the owner signs in from their own IP (test-covered) |
| A3 | 12 anonymous 24 MB uploads in parallel | **Worked**: backend memory went 47 → 371 of 512 MiB | Rejected before reading the body; 41 → 61 MiB |
| A4 | Login flood with random usernames (Argon2 64 MiB each), combined with A3 | **Crashed the backend** (OOM-killed, 60 × 502) | 80 parallel: 18 processed, 62 shed with 503; peak 62 MiB; health stayed instant; no restart |
| A5 | 5 KB Markdown import crafted to trigger regex backtracking (signed in) | **Event loop blocked 107 s** (whole server frozen) | Linear parser; 200 KB hostile input takes under 200 ms |
| A6 | Guess MFA codes on a pending sign-in | Limited only per IP | Pending sign-in discarded after 5 wrong codes |
| A7 | Slowloris (send headers slowly) | Not bounded at the edge | Connection dropped after 10.0 s |
| A8 | Hidden files and traversal: `/.env`, `/.git/config`, source maps, `../` and `%2e%2e` variants, `/api/../` | Nothing exposed (SPA fallback only) | Same |
| A9 | Odd methods (TRACE/PUT/DELETE/OPTIONS/CONNECT), malformed JSON, invalid URI encoding, type confusion (`{"$gt":""}`), 20 KB headers, oversized cookies | Clean 4xx; no stack traces | Same |
| A10 | Unauthenticated access to every API route | 401 everywhere (test-covered) | Same |
| A11 | Container image CVEs (Trivy, fixable HIGH/CRITICAL) | Backend 10 (Debian 12 and the bundled npm); each Caddy image 84+ | **0 / 0 / 0**: Debian 13 base, npm removed from runtime, Caddy rebuilt with Go 1.26.9 and x/net 0.60.0 |

Additional hardening from the review:

- Attachments are revalidated (`no-cache` + ETag) instead of being cached for a day.
- Logout sends `Clear-Site-Data: "cache"`, so a shared computer keeps no private images.
- Audit-log retention: failed sign-ins 90 days, other events 2 years.
- libvips memory is bounded (no operation cache, concurrency 1, 40 MP limit).

## Pre-launch checklist (do these on the VPS)

The application cannot protect the server it runs on. Before pointing DNS at it:

1. **Firewall:** allow only `22/tcp` (ideally restricted to your IP), `80/tcp`, `443/tcp` and `443/udp`, e.g. `ufw default deny incoming && ufw allow 22/tcp && ufw allow 80,443/tcp && ufw allow 443/udp && ufw enable`. Docker-published ports bypass UFW, but this stack publishes only 80/443 (or loopback-only ports in Option B), and the backend publishes nothing.
2. **SSH:** key-only (`PasswordAuthentication no`, `PermitRootLogin no`); consider fail2ban.
3. **Updates:** enable `unattended-upgrades`; redeploy monthly (`./scripts/deploy.sh`) to pick up patched base images; re-run the image scan (see below).
4. **Secrets:** `.env` is `chmod 600` and owned by your deploy user. Generate `APP_SECRET_KEY` with `openssl rand -base64 48`. Store it and `RESTIC_PASSWORD` in a password manager.
5. **Account first, then MFA:** create the account (there is no public sign-up, so nothing can be claimed in the meantime), sign in, and **enable two-factor authentication immediately**. Pick a username that isn't trivially guessable.
6. **Verify real client IPs:** after signing in, open Settings → Security. "Active sessions" must show *your* public IP, not a `172.x` Docker address. If it shows `172.x`, Docker is proxying connections in userspace (usually IPv6 without ip6tables): enable `"ip6tables": true` in `/etc/docker/daemon.json`, or disable IPv6 for the domain. Otherwise per-IP limits would treat all visitors as one.
7. **TLS:** confirm `https://` works and `http://` redirects; optionally check with an SSL test service. HSTS is sent automatically.
8. **Backups:** configure restic, run `./scripts/backup.sh --check` once by hand, and schedule it in cron with `BACKUP_NOTIFY_URL` so silent failures get noticed.
9. **Monitoring:** watch `docker compose logs backend` for `auth.login.failure` bursts. Security events are also listed in Settings → Security.

Re-run the image vulnerability scan at any time:

```bash
for i in uninotes-backend uninotes-frontend uninotes-caddy; do
  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:0.67.2 image \
    --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed $i:latest
done
```

## Known limitations (V1)

- Rate limits and login throttles are kept in memory. They reset when the backend restarts, which is acceptable for a single instance.
- The app is single-user by design, though the schema and every query are ownership-aware. Multi-user administration is not exposed.
- The style CSP allows `'unsafe-inline'`, which three rendering libraries need. Script execution remains fully restricted.
- During a large distributed login flood, the owner's *new* sign-ins can receive a temporary 503 (load shedding), which is better than the server crashing. Existing sessions are unaffected because they never hash passwords.
- The Caddy images pin a self-built binary (Go 1.26.9, x/net 0.60.0). When an official Caddy release ships with these fixes, switch back to the official image by removing the build stage.
- Network-level DDoS (bandwidth floods) can't be solved inside the app. If that becomes a concern, put the domain behind a DDoS-absorbing CDN or proxy.
