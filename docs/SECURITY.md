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
| Brute-force protection | Per-IP limiter (failed attempts only) plus a per-account lockout window. MFA and sensitive endpoints are also limited | `auth.test.ts` (rate limit) |
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

## Request security

| Control | Implementation |
|---|---|
| CSRF | Origin and `Sec-Fetch-Site` checks against `APP_ORIGIN`, plus a per-session synchronizer token in `X-CSRF-Token`, plus SameSite cookies (`middleware/csrf.ts`) |
| CORS | No CORS headers at all. The app is same-origin, so browsers block cross-origin reads |
| Authorisation | Every route declares `auth` (default on) in `defineRoute`. Every query is scoped by `user_id`, and other users' resources return 404 |
| Input validation | Zod schemas for params, query and body on every route; date-only strings are validated as real calendar dates |
| Body limits | JSON 2 MB, upload 10/25 MB (configurable), import 2 MB, Caddy hard cap 40 MB |
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

- `.env` holds placeholders in the template only, and is git-ignored. `deploy.sh` warns if it is not `chmod 600`.
- Logs redact cookies, authorisation and CSRF headers, passwords, codes, tokens and secrets.
- Backups contain no sessions and no plaintext secrets. The offsite copy is encrypted by restic, and backups are verified with checksums.
- Containers run as non-root with a read-only root filesystem, `cap_drop: ALL`, `no-new-privileges`, resource limits and internal-only networks. Only the reverse proxy publishes ports.
- `npm audit --omit=dev` reports 0 vulnerabilities for both packages. CI runs it on every push. A transitive `katex` advisory (GHSA-238p-pmpm-9mq7) is resolved with an npm override to KaTeX 0.19.

## Recommendations for the operator

1. Enable two-factor authentication right after creating the account, and store the recovery codes.
2. Keep `APP_SECRET_KEY` and `RESTIC_PASSWORD` in a password manager.
3. Keep the VPS patched. Allow only SSH and 80/443 through the firewall, and use key-only SSH.
4. Run `./scripts/backup.sh --check` weekly, and occasionally `restore.sh --verify-only`.
5. Run `npm audit` and rebuild images periodically to pick up base-image security updates (`./scripts/deploy.sh`).

## Known limitations (V1)

- Rate limits and account lockouts are kept in memory. They reset when the backend restarts, which is acceptable for a single instance.
- The app is single-user by design, though the schema and every query are ownership-aware. Multi-user administration is not exposed.
- The style CSP allows `'unsafe-inline'`, which three rendering libraries need. Script execution remains fully restricted.
