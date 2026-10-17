# UniNotes REST API

The authoritative contract is **[Backend/openapi.json](../Backend/openapi.json)** (OpenAPI 3.1). It is generated from the same Zod schemas that validate requests, so it cannot drift: CI fails if it is out of date. Regenerate it with `cd Backend && npm run openapi`. A signed-in user can also fetch it at `GET /api/openapi.json`.

## Conventions

- **Base path:** `/api`. Same-origin only, with no CORS.
- **Authentication:** an HttpOnly session cookie set by `POST /api/auth/login`. Every endpoint except `GET /api/health`, `GET /api/auth/session` and `POST /api/auth/login` requires a signed-in session.
- **CSRF:** for `POST`/`PATCH`/`DELETE` from a signed-in session, send `X-CSRF-Token: <csrfToken>`. The token comes from `GET /api/auth/session` or the login response. The `Origin` header, if present, must equal the app origin.
- **Success:** `{ "data": … }`. Paginated lists add `"meta": { "total", "page", "pageSize" }`.
- **Errors:** `{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [ … ] } }`. Common codes: `UNAUTHENTICATED` (401), `INVALID_CREDENTIALS` (401), `CSRF_TOKEN_INVALID` / `CSRF_ORIGIN_MISMATCH` (403), `NOT_FOUND` (404; also used for other users' resources), `REVISION_CONFLICT` / `DUPLICATE_IMPORT` (409), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `RATE_LIMITED` (429).
- **Dates:** timestamps are ISO-8601 UTC. `lectureDate` is a date-only `YYYY-MM-DD` value.
- **Pagination:** `page` (starting at 1) and `pageSize` (1–100, default 20).

## Endpoints

| Group | Method and path | Purpose |
|---|---|---|
| Health | `GET /health` | Liveness and database check (public) |
| Auth | `GET /auth/session` | Session state and CSRF token (public) |
| | `POST /auth/login` | `{identifier, password}` → `authenticated` or `mfa_required` |
| | `POST /auth/login/mfa` | `{code}`: TOTP or recovery code |
| | `POST /auth/logout`, `POST /auth/logout-all` | End this session, or every session |
| Notes | `GET /notes` | List with filters (below) |
| | `POST /notes` | Create `{title?, markdownContent?, moduleId?, lectureDate, tags?, isFavourite?}` |
| | `GET /notes/:id` | Get a note (`?includeDeleted=true` for the recycle bin) |
| | `PATCH /notes/:id` | Update. Title/content changes require `revision` and return **409 REVISION_CONFLICT** with `details.current` if it is stale |
| | `DELETE /notes/:id` | Move to the recycle bin |
| | `POST /notes/:id/restore` | Restore from the recycle bin |
| | `POST /notes/:id/archive`, `/unarchive` | Archive state |
| | `POST /notes/permanent-delete` | `{ids}` or `{all:true}`; only affects notes already in the bin |
| Versions | `GET /notes/:id/versions`, `GET /notes/:id/versions/:versionId` | History |
| | `POST /notes/:id/versions` | Save the current state as a version |
| | `POST /notes/:id/versions/:versionId/restore` | Restore as a new revision |
| Modules | `GET /modules?status=active\|archived\|all`, `POST /modules` | List and create |
| | `GET/PATCH /modules/:id`, `POST /modules/:id/archive`, `/unarchive` | Manage |
| | `DELETE /modules/:id` | Body `{confirmName}` must equal the module name. Its notes are kept and become unassigned |
| Tags | `GET /tags` | Tags in use, with counts |
| Calendar | `GET /calendar?from&to&moduleId` | Note counts per **lecture date** (maximum 400 days) |
| Search | `GET /search?q=…` | FTS5 search plus all note filters. Snippet highlights are delimited by `\u0001` … `\u0002` |
| Dashboard | `GET /dashboard?weekStart` | Stats, recent notes, modules |
| Attachments | `POST /attachments` (multipart `file`, `noteId`) | Upload PNG/JPEG/WebP (re-encoded) or PDF |
| | `GET /attachments/:id`, `GET /attachments/:id/content` | Metadata or content (images inline; PDFs as downloads; `?download=1` forces a download) |
| | `GET /notes/:id/attachments`, `DELETE /attachments/:id` | List or delete |
| Import | `POST /import` (multipart `file`, `lectureDate`, `moduleId?`, `title?`, `tags?`, `allowDuplicate?`) | Import a `.md` file as a new note |
| Export | `GET /export/notes/:id/markdown` | Markdown with YAML front matter |
| | `GET /export/notes/:id/zip`, `GET /export/modules/:id/zip` | Markdown plus assets, with links rewritten to relative `assets/…` paths |
| | `GET /export/all?includeVersions=true` | Everything, plus `manifest.json` |
| Settings | `GET/PATCH /settings/account`, `PATCH /settings/preferences` | Account and UI preferences |
| | `GET /settings/security`, `GET /settings/security/events` | MFA status, sessions, audit events |
| | `DELETE /settings/security/sessions/:sessionId` | Revoke another session |
| | `POST /settings/security/password` | `{currentPassword, newPassword, code?}` |
| | `POST /settings/security/mfa/setup`, `/enable`, `/disable`, `/recovery-codes` | TOTP lifecycle |
| | `GET /settings/data` | Storage statistics |
| Meta | `GET /openapi.json` | This contract |

### Note filters (`GET /notes`, `GET /search`)

`q` (search only), `status=active|archived|all|deleted`, `moduleId` (a UUID, or `none` for notes without a module), `academicYear`, `date`, `from`, `to`, `tags` (comma-separated; all must match), `favourite=true|false`, `updatedWithinDays`, `sort=relevance|lecture_desc|lecture_asc|updated|title`, `page`, `pageSize`.

## Example

```bash
# Sign in (stores the cookie) and read the CSRF token
curl -c jar -H 'Content-Type: application/json' -H 'Origin: https://notes.example.com' \
  -d '{"identifier":"alice","password":"…"}' https://notes.example.com/api/auth/login
CSRF=$(curl -s -b jar https://notes.example.com/api/auth/session | jq -r .data.csrfToken)

# Create a note
curl -b jar -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' -H 'Origin: https://notes.example.com' \
  -d '{"title":"Lecture 1","markdownContent":"# Intro","lectureDate":"2025-10-01"}' \
  https://notes.example.com/api/notes
```
