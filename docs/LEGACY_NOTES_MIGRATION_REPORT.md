# Legacy University Notes — Migration Report

Status: **Import complete and verified (2026-10-20).** You approved the dry run and the `image-9.png` repair, and all 118 legacy notes, 6 generated source-file notes, 330 images and 51 source files are now in the development database for `switchback`. The only item still outstanding is a manual check in the browser (§10).
Date: 2026-10-20.
Related documents:
- [`LEGACY_NOTES_ANALYSIS.md`](LEGACY_NOTES_ANALYSIS.md) (revision 3);
- [`LEGACY_NOTES_MAPPING.md`](LEGACY_NOTES_MAPPING.md) (revision 3);
- the approved mapping: [`legacy-import/uni-test.mapping.json`](legacy-import/uni-test.mapping.json);
- the dry-run manifest: [`legacy-import/uni-test.dry-run.manifest.json`](legacy-import/uni-test.dry-run.manifest.json);
- the dry-run report: [`legacy-import/uni-test.dry-run.report.md`](legacy-import/uni-test.dry-run.report.md);
- **the import manifest: [`legacy-import/uni-test.import.manifest.json`](legacy-import/uni-test.import.manifest.json)** and its report, [`legacy-import/uni-test.import.report.md`](legacy-import/uni-test.import.report.md);
- the post-import re-run: [`legacy-import/uni-test.post-import-dry-run.report.md`](legacy-import/uni-test.post-import-dry-run.report.md).

## 1. Summary

| Stage | Result |
|---|---|
| A. Nullable lecture dates and source-code attachments | Implemented and tested. The migration was tested on an isolated copy, then applied to the development database after a verified backup. Existing data was verified unchanged |
| B. Importer | `npm run import:legacy` (CLI only; no HTTP endpoint). 15 dedicated tests |
| C. Dry run | **0 blocking problems**. Every expected total reconciles (§4). One transformation needed your approval (§5); you approved it on 2026-10-20 |
| Rehearsal on a disposable copy | Full import and re-run on a scratch copy of the database: 124 notes, 330 images and 51 source files imported; the second run created nothing; 33/33 integrity checks passed (§6) |
| Actual import | **Done.** 25 modules, 124 notes, 330 images and 51 source files. 33/33 database checks and 29/29 application checks passed. A re-run finds everything already imported (§9) |

## 2. Stage A — application changes

### 2.1 Nullable `lecture_date`

- **Migration `Backend/drizzle/0002_nullable_lecture_date.sql`:** the `notes` table is rebuilt using SQLite's documented procedure. Every row is copied unchanged and the four indexes are recreated.
- **Foreign-key safeguard (`Backend/src/db/migrations.ts`, `runMigrations`):**
  - Foreign-key enforcement is switched off only for the duration of the migration transaction. This has to happen outside the transaction, because SQLite ignores that setting inside one.
  - `PRAGMA foreign_key_check` must report nothing before the commit; otherwise everything is rolled back.
  - The previous setting is restored in a `finally` block, whether the migration succeeds or fails.
  - It refuses to start inside an open transaction.
  - It writes the same `__drizzle_migrations` rows as Drizzle's migrator.
  - Enforcement is not weakened anywhere else: every application connection still sets `foreign_keys = ON`.
- **Backend:**
  - create, patch and import accept `null`;
  - sorting by lecture date puts undated notes last (`NULLS LAST`) in both directions;
  - the calendar and the date filters exclude NULLs, while the module, year, tag and search views include them;
  - exports write `lecture_date: null` and name the file `undated-<title>.md`.
- **Frontend:**
  - the "Undated" label (note cards, quick search);
  - the editor's date field can be cleared, which sets `null`, or set at any time;
  - an existing undated note is no longer given today's date when opened (this fixes a fallback that would have done that);
  - the import dialog's date is optional;
  - the calendar never places an undated note on a day.
- `openapi.json` has been regenerated.

### 2.2 Source-code attachments

- `.c .h .py .js .ts .html` are accepted through the normal upload path, and therefore from the editor's file picker and Files panel.
- **Content checks:**
  - no recognisable binary signature;
  - no NUL bytes;
  - strictly valid UTF-8;
  - non-empty;
  - at most 1 MB.
- **Storage:** bytes are stored unchanged, under an opaque name in private attachment storage, as `kind = file`, `mime_type = text/plain`.
- **Serving:** always as a download (`Content-Disposition: attachment`, `text/plain`, `nosniff`, `CSP: default-src 'none'; sandbox`), so HTML and JavaScript can never render or run.
- **Unchanged:** image and PDF handling, and ownership checks. Content sniffing still takes priority over the file name, so a real PDF named `x.ts` remains a PDF.
- `storeUpload` was split into `prepareUpload` (validate and process), `writeStoredFile` and `attachmentRow`, so the importer can commit a note and its attachments together. Normal uploads behave exactly as before.

### 2.3 Migration safeguard, step by step

| Step | Result |
|---|---|
| 1. Isolated, consistent copy | Made with SQLite's backup API from an immutable (write-free) connection. The real database checksum was unchanged |
| 2–3. Migrate the copy with the real runner (`DATABASE_PATH=<copy> npm run db:migrate`) | Applied `0002`. Every data table, including note versions, tags, attachments, users, sessions, audit events and the search index, was **identical** before and after, compared row by row as SHA-256 hashes. The only change: one new `__drizzle_migrations` row |
| 4. Integrity and FK checks | `integrity_check` ok; `foreign_key_check` empty; all 17 indexes present; `lecture_date` now nullable |
| 5. Real migration runner | Yes: `npm run db:migrate` (`scripts/migrate.ts` → `runMigrations`) |
| 6. FK enforcement restored | On the copy: the app connection reports `foreign_keys = 1`. In tests: restored after success, after a failing migration (rolled back) and after an FK violation (aborted and rolled back) |
| 7. The app can read the result | App services (`listModules`, `queryNotes`, `loadNote`) read the Data Science module and the soft-deleted Test note with its date intact |
| Proof the safeguard matters | With the `foreign_keys = OFF` line temporarily removed, the preservation test **fails** (the rebuild cascades into child tables). With the line restored, it passes |
| Verified backup | `npm run backup` → `Backend/data/backups/local/2026-10-20T18-27-30-704Z`. `--verify` checked the database checksum, integrity, foreign keys and the attachment checksum: OK |
| Applied to the development database | `npm run db:migrate` (which also took `data/backups/pre-migration/uninotes-2026-10-20T18-27-46-908Z.db`). Data tables identical before and after; integrity ok; no FK violations; app reads it; migrations 3/3 |

Two things you may notice in `Backend/data/db/`:
- After the migration closed cleanly, SQLite removed the empty `-wal` and `-shm` files, which is normal in WAL mode.
- The read-only dry run later created an empty `-wal` (0 bytes) and a `-shm` index. That is also normal when reading a WAL database. The database file's checksum was unchanged by the dry run.

## 3. Stage B — the importer

```
cd Backend
npm run import:legacy -- --zip ../Imports/Uni-test.zip --mapping ../docs/legacy-import/uni-test.mapping.json \
  --username switchback --dry-run --manifest <out.json> [--report <out.md>]
# real import: replace --dry-run with --confirm (after npm run backup)
```

| Requirement | How it is met |
|---|---|
| ZIP input and archive safety | Streamed with `yauzl`, which moved from dev to runtime dependencies; it was already in the lockfile, so no new package was added. It rejects absolute paths, `..`, backslashes, symlinks, encrypted entries, entries outside the archive root, more than 5,000 entries, more than 200 MB in total or 50 MB per entry, compression ratios over 200:1 for large entries, and entries whose inflated size differs from the declared size. Nothing is executed |
| Archive integrity | The ZIP's SHA-256 must match the mapping before the run, and it is checked again afterwards |
| Target user | Looked up by `--username` at run time, which must equal the mapping's `targetUsername`. The importer stops if the user is missing and never creates users |
| Module mapping | From the mapping file. A module is reused by name + academic year (case-insensitive). A name that exists with a different year is a blocking conflict. Existing modules are never modified |
| Every file accounted for | Every archive file must be a mapped note, an image a note references, a mapped source file or an explicit exclusion. Anything else blocks the run. Files listed as compiled executables are checked to really be ELF binaries |
| Markdown | Decoded with the existing strict UTF-8 decoder. Only approved transformations are applied, each matched exactly or reported as a problem |
| Images | Resolved against the note's folder; old root-relative paths are remapped only when exactly one file matches; code blocks are ignored. Each unique source image becomes one attachment, processed through the existing pipeline. Notes that share an image are imported in one transaction and share the attachment |
| Source files | Validated as source text and stored byte-for-byte, attached to the approved generated "Source files" notes (null date; tags `legacy-import`, `source-files`) |
| Existing application code | `createNote` (note, tags, `import` version and search index in one transaction), `createModule`, and the attachment validators |
| Transactions and failure handling | Each note, or group of notes sharing images, is one transaction including its attachments. Files are written first and deleted again if the transaction fails. The importer stops at the first failure; everything committed before it stays consistent, and a re-run continues from there |
| Duplicates and re-runs | `source_hash = sha256("uninotes-legacy:v1\n" + path + "\n" + sha256(bytes))`, so identical files in different places remain distinct. The check includes soft-deleted notes, so deleting an imported note never brings it back. Existing notes are never updated |
| Dry run | Opens the database **read-only**, so SQLite refuses any write. Images and source files are still fully validated in memory |
| Pending approvals | A transformation marked `pendingApproval` is shown in the dry run, and a real run refuses to start until the flag is removed |
| Manifest | One entry per archive file, recording: source path, source SHA-256, target user ID, module ID, note ID, attachment IDs, status, title, date (and any correction), tags, transformations, warnings, and the original vs stored image size. No secrets |

## 4. Stage C — dry-run results (against the real database and archive)

Run as `npm run import:legacy -- … --dry-run`. Exit code 0. **Blocking problems: 0.**

| Item | Expected | Dry run |
|---|---:|---:|
| Target account | `switchback` / Wesley | `switchback` / Wesley / `751aab78-49e0-440f-a517-f0ea1db5a4d9` |
| New modules / reused | 25 / 0 | 25 / 0 |
| Original Markdown notes | 118 | 118 |
| Generated source-file notes | 6 | 6 |
| Total new notes | 124 | 124 |
| PNG images | 330 | 330 (one downscaled: 5405×3901 → 4096×2956) |
| Image references | 334 | 334, *including the 2 that need the pending repair* |
| Source-code files | 51 | 51, all byte-for-byte |
| Excluded compiled executables | 41 | 41 (all verified as ELF) |
| Excluded repository metadata | 4 | 4 |
| Original notes without a lecture date | 33 | 33 |
| Corrected lecture date | 1 | 1 (`Maths 31-10-32.md` → 2023-10-31; the original filename date is in the manifest) |
| New notes without a lecture date | 39 | 39 |
| Empty notes (tagged `legacy-empty`) | 4 | 4 |
| Archive files accounted for | 544 | 544, each exactly once |
| Notes matching the approved mapping (module, date, title) | 118 | 118 |
| ZIP checksum before and after | unchanged | unchanged (`c3547a91…5d962b07`) |
| Database file checksum before and after | unchanged | unchanged |

Transformations in the plan:
1. Image references are rewritten to `/api/attachments/<id>/content`.
2. The `von.png` path is remapped (`/Uni/Sessions/Computing/resources/von.png` → `Uni/Year0 /Sessions/Computing/resources/von.png`). This is the dry run's only warning, and it is expected.
3. The Maths HTML heading is converted (approved).
4. The 7 citation markers in `react-typescript.md` are removed, on lines 80, 109, 191, 318, 433, 575 and 615 (approved).
5. **The `image-9.png` repair, pending your approval** (§5).

Duplicates and conflicts:
- no module conflicts;
- no existing notes match any source key;
- `IPR08-05-24_.md` is imported separately and tagged `legacy-near-duplicate`;
- the four images both IPR notes use are stored once and shared.

## 5. Found during the dry run: broken image markup (needs your approval)

The first dry run **blocked** on `10th-week/image-9.png`, reporting it as unaccounted for, and counted 332 image references, not 334.

The cause: in both `IPR08-05-24.md` and `IPR08-05-24_.md`, the reference is written across three lines with a whitespace-only line in the middle (`![` / blank / `](image-9.png)`). CommonMark treats that blank line as a paragraph break, so this has **never rendered as an image**, in UniNotes or in VS Code.

UniNotes' own parser, run over all 118 notes, finds exactly the 332 references the importer found. My phase-1 count of 334 was wrong; its pattern let `![…]` span line breaks.

**Proposed:** in the imported copies only, replace those lines with `![](image-9.png)`, so the image displays. The mapping carries this as `pendingApproval: true`. The dry-run totals above assume the repair. The importer will not run for real until you approve it, at which point I set the flag to false.

If you decline, the text stays exactly as written. `image-9.png` could then still be stored as an attachment of both notes, which needs a small importer option.

## 6. Rehearsal on a disposable copy (not your data)

The real import was rehearsed against a scratch copy of the development database and a scratch attachments folder, with the repair approved only in a scratch copy of the mapping:
- **Run 1:** 25 modules, 124 notes, 330 images and 51 source files imported, with no problems.
- **Run 2:** everything detected as `already-imported`. No rows and no files were added.

Independent verification of the result (33 checks, all passed):

| Area | Checks |
|---|---|
| Ownership | All 124 notes, 25 modules and 381 attachments belong to `switchback`. Still exactly one user |
| Data integrity | `integrity_check` ok; no FK violations; no duplicate source keys; no duplicate modules |
| Your existing data | Every pre-existing row (users, modules, notes, versions, attachments, tags) is byte-identical. The Data Science module and the soft-deleted Test note are still present |
| Assignments | Module names and years as approved. Every note in its manifest module, with its manifest date. 39 undated notes; the corrected date is stored as 2023-10-31 |
| Images | All 334 references point to existing attachments of the user. No unconverted local image paths remain. Every attachment file exists with a matching checksum. One image is stored at 4096×2956 |
| Source files | All 51 stored as `text/plain`, with SHA-256 identical to the archive, and linked from the generated notes |
| Search and history | Exactly one search-index row per note; an `import` version for every imported note |
| Transformations | Maths heading converted; citation markers gone; empty notes stored empty |

## 7. Tests and builds

| Check | Backend | Frontend |
|---|---|---|
| Unit and integration tests | **150 passed** (12 files) | **52 passed** (11 files) |
| New tests | Migrations (5): preservation of every table, failing-migration rollback, FK-violation abort, FK restored, refusal inside a transaction. Undated notes (7). Source attachments (20). Legacy importer (15) | Date label (2), note card (2), calendar exclusion of undated notes (1) |
| Prettier / ESLint / TypeScript | pass / pass / pass | pass / pass / pass |
| Production build | pass (includes `dist/scripts/import-legacy.js`) | pass |
| `npm audit --omit=dev` | 0 vulnerabilities | not run |

`openapi.json` was regenerated because the API changed (nullable dates, source attachments). It differs from the last commit until these changes are committed; CI's `git diff --exit-code openapi.json` check will pass after that.

**Not verified yet:**
- the UI in a browser: the dashboard, opening notes, preview rendering, the editor date field, autosave, and downloads from the Files panel;
- the end-to-end Playwright suite;
- the actual import.

The UI checks are planned for after the import (Phase 7). No UI behaviour is claimed as verified here.

## 8. Approval

On 2026-10-20 you approved the dry run and transformation 5, the `image-9.png` repair. The `pendingApproval` flags were removed from the mapping, and the approval is noted in each transformation's `reason`.

## 9. The import

| Step | Result |
|---|---|
| Server stopped / no open handles | No UniNotes process running; nothing held the database open |
| Fresh verified backup | `Backend/data/backups/local/2026-10-20T18-49-34-893Z`, `--verify` OK (1 note, 1 attachment). The earlier backup `…T18-27-30-704Z` is from before the migration |
| Data unchanged since the migration | Row-by-row comparison with the post-migration snapshot: identical |
| Import | `npm run import:legacy -- … --confirm`, exit 0. Every unit committed; no failures |
| Result | Modules: 25 created, 0 reused. Notes: 118 original + 6 generated imported. Images: 330 imported (334 references; 1 downscaled to 4096×2956). Source files: 51 imported. Excluded: 41 executables + 4 metadata files. New notes without a lecture date: 39. Corrected date: 1 |
| Archive | SHA-256 `c3547a91…5d962b07` before and after (unchanged) |
| Database totals afterwards | 1 user; 26 modules (25 + Data Science); 125 notes (124 + the soft-deleted Test note); 382 attachments (381 + the Test note's image); 382 files in `data/attachments` |

### 9.1 Database verification (33 checks, all passed)

These are the same checks as the rehearsal in §6, run on the real database, using the import manifest and the pre-import snapshot. They cover:
- ownership of every note, module and attachment;
- still exactly one user;
- integrity and foreign keys;
- module names, years and assignments;
- lecture dates (39 NULL; 2023-10-31 corrected);
- no duplicate source keys or modules;
- every pre-existing row byte-identical (the Data Science module and the Test note with its attachment are preserved);
- 330 images and 51 source attachments, with every file present and its checksum matching;
- 334 image references resolving to the user's attachments, with no leftover local paths;
- source files byte-for-byte as `text/plain`;
- one search-index row per note;
- an `import` version per note;
- the transformations applied.

### 9.2 Idempotency

A dry run after the import (`uni-test.post-import-dry-run.*`) reports:
- 25 modules reused, 0 created;
- 118 + 6 notes already imported;
- 330 images and 51 source files already imported;
- **0 new notes**.

While checking this, I fixed a reporting flaw: a dry run used to list images and source files as "planned" when their notes already existed. The flaw was in the report only, since a real run would have created nothing. The importer test suite now covers it. The importer's own tests also verify, on an isolated database, that a second real run adds no rows and no files, and the rehearsal (§6) showed the same.

### 9.3 Application verification (29 checks, all passed)

These checks ran against a **copy** of the imported database and attachments, using the real Express application in-process over HTTP. A temporary session was created on the copy only (your password was not needed). The edit checks and a throwaway second account also existed only on the copy, which has since been deleted. The real database shows no trace of them.

| Area | Result |
|---|---|
| Dashboard | Loads |
| Modules | 26 listed; grouped by year (2023/24, 2024/25, 2025/26, 2026/27, Independent Study); every module's note count matches the manifest |
| Notes under modules | Every module lists exactly its notes; `idk` appears under "No module" |
| Opening notes | All 124 open |
| Markdown | Parsed with the frontend's own parser (remark + GFM + math): all 334 images are attachment images; 112 code blocks and 1 table, the same counts as the originals (94 fenced + 18 indented). *The analysis's "96 fenced blocks" was a line-based count, not how CommonMark counts* |
| Content fidelity | All 118 notes identical to their originals apart from the recorded transformations and the rewritten image URLs |
| Images | All 330 served inline as PNG through the authenticated attachment API |
| Source files | All 51 download byte-for-byte as `text/plain` attachments with `nosniff` |
| Search | Finds notes by content ("normalisation", "von neumann"), by module name ("kotlin"), and the generated source-file notes |
| Calendar | Exactly the 85 dated notes appear; 31 Oct 2023 shows the corrected Maths note together with Session 31-10-23; undated notes never appear |
| Editing and autosave | An imported note saves with a revision bump; a stale save is rejected with a conflict; the lecture date can be assigned and cleared |
| Exports | Markdown export has no private URLs and links `assets/…von.png`; the note ZIP includes the image; the Problem Solving module ZIP includes all 45 C files byte-for-byte and names the undated note `undated-…`; the full export contains all 124 notes |
| Ownership | Another account cannot open an imported note or download an attachment, and sees no imported modules |

## 10. Remaining manual actions

1. **Check it in the browser** (not done: I have no browser here). Sign in as `switchback` and check:
   - the dashboard and the Modules page grouping;
   - open a few notes with images, for example *Computing | Saturday class | week 3* (the `von.png` image), *Normalisation* (39 images) and *Individual Related Project* (repaired `image-9.png`);
   - code highlighting in *React JS Refresh*;
   - the table in the one note that has one;
   - the editor's date field on an undated note (it shows empty and can be set or cleared);
   - downloading a file from *Problem Solving — Source files*;
   - the calendar for October 2023.
2. **Run the end-to-end browser tests** (`cd Frontend && npm run test:e2e`), which were not run.
3. **Commit the changes.** Nothing has been committed. `Imports/` stays ignored by git; `Backend/data/` (the database, attachments and backups) is ignored too.
4. **Keep the backups**: `Backend/data/backups/local/2026-10-20T18-49-34-893Z` (just before the import) and `Imports/Uni-test.zip`. To undo the import completely, stop the app and restore that backup with `scripts/restore.ts`.
5. If this database is later deployed to your VPS, run `npm run db:migrate` there first, so that the nullable-date migration is applied.
