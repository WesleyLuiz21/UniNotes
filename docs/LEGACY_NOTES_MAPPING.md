# Legacy University Notes — Module Mapping & Migration Plan

Status: **Revision 3 — approved and imported on 2026-10-20.** Everything in this document, including transformation 4 (the `image-9.png` repair), was approved and imported as mapped. The results are in [`LEGACY_NOTES_MIGRATION_REPORT.md`](LEGACY_NOTES_MIGRATION_REPORT.md).
Archive: `Imports/Uni-test.zip`, SHA-256 `c3547a918b210e1d1ec2e4760d8ad194072c6f4a919b22aaab1753f35d962b07` (unchanged).
Companion document: [`LEGACY_NOTES_ANALYSIS.md`](LEGACY_NOTES_ANALYSIS.md).

Changes in revision 3:
- The approved mapping is now a machine-readable file, [`legacy-import/uni-test.mapping.json`](legacy-import/uni-test.mapping.json), which the importer reads. It lists every archive file explicitly.
- §1: the `0002_nullable_lecture_date` migration has been applied. Existing data was verified unchanged.
- §9: a fourth transformation, repairing the broken `image-9.png` markup (see `LEGACY_NOTES_ANALYSIS.md` §5.1), was added and approved on 2026-10-20.
- The implementation, dry-run and test results are in [`LEGACY_NOTES_MIGRATION_REPORT.md`](LEGACY_NOTES_MIGRATION_REPORT.md).

Changes in revision 2 (since revision 1):
- The database was found, and the target account is confirmed (§1).
- Your decisions on dates (nullable `lecture_date`), source code (download-only attachments), empty notes and citations are incorporated.
- The 18 flagged assignments are resolved with recommendations (§3).
- The plan has been revised (§7–§8).

## 1. Target account and existing data (confirmed)

Queried read-only, with SQLite `immutable=1`, against `/workspaces/UniNotes/Backend/data/db/uninotes.db`:

| Item | Value |
|---|---|
| Username | `switchback` (the only user) |
| Display name | `Wesley`. Stored with a capital W; it matches `wesley` apart from case |
| Internal user ID | `751aab78-49e0-440f-a517-f0ea1db5a4d9`. Shown here for verification only; the importer always looks it up by username at run time |
| Existing modules | 1: **Data Science** (`academic_year` `2026/27`, active) |
| Existing notes | 1: **Test note** (in Data Science, 2026-10-18, **soft-deleted**) |
| Existing attachments | 1 (an image belonging to Test note) |
| Migrations applied | `0000_init`, `0001_search_fts` at the time of the check. **`0002_nullable_lecture_date` was applied on 2026-10-20**, after the isolated test and a verified backup (see the migration report) |
| Integrity | `PRAGMA integrity_check` = ok; `foreign_key_check` = no violations |

**Module reuse:** none of the 25 proposed modules matches *Data Science / 2026/27*, so all 25 would be created. The existing module and note are left untouched.

## 2. Module structure

There are 25 modules plus 1 unassigned note. The counts below already reflect the recommendations in §3.

| Academic year | Module | Notes | Undated (NULL) | Image refs | Source evidence |
|---|---|---:|---:|---:|---|
| 2023/24 | Foundation Year Induction & General | 5 | 1 | 3 | `InductionsYear0/` and the root `readme.md` |
| 2023/24 | Computing Foundations | 15 | 0 | 5 | Year 0 semester 1 "Computing" sessions (Tuesdays and Saturdays) |
| 2023/24 | Group Technology Project | 11 | 0 | 0 | Year 0 semester 1 "Group Project" / "Group Technology" sessions (Wednesdays) |
| 2023/24 | Computing Maths | 5 | 1 | 0 | `Computing Maths/` |
| 2023/24 | Digital Media Technologies | 11 | 0 | 22 | Semester 2 `DM*` / `MD*` notes |
| 2023/24 | Problem Solving | 6 | 2 | 10 | Semester 2 `PB*` notes; heading "Problem Solving"; taught in C |
| 2023/24 | Individual Degree Related Project | 13 | 3 | 42 | Semester 2 `IDRP` / `IPR` / `IRP` / `IDPR` / `IRPD` / `IR` notes |
| 2024/25 | Networking | 6 | 3 | 49 | Year 1 semester 1 `NET*` notes |
| 2024/25 | User Experience (UX) | 7 | 4 | 17 | Year 1 semester 1 `UX*` notes and `Airbnb.md` |
| 2024/25 | Problem Solving Through Programming | 2 | 1 | 1 | `PSTP141024.md` and `Week2/Python.md` |
| 2024/25 | Data Analysis | 3 | 0 | 22 | `SecondSemester/Data Analysis/` |
| 2024/25 | Database | 4 | 1 | 8 | `SecondSemester/Database/`, plus `05-03-2025.md` (§3) |
| 2024/25 | Web Technologies | 2 | 0 | 4 | `SecondSemester/Web/`; heading "Web Tech" |
| 2025/26 | Advanced Database Systems | 3 | 1 | 43 | Folder name |
| 2025/26 | Analytics and Business Intelligence | 4 | 1 | 13 | Folder name, plus `30-10-2025.md` (§3) |
| 2025/26 | Object-Oriented Design and Development | 4 | 1 | 25 | Folder `Object Oriented Design and Dev` |
| 2025/26 | Human-Computer Interaction (HCI) | 1 | 0 | 0 | Folder `HCI` |
| 2025/26 | Research Methods | 1 | 0 | 0 | Folder `Reasearch Methods` (spelling corrected in the module name only) |
| 2025/26 | Web Application Development | 3 | 2 | 1 | Folder `WebAppDev` |
| Independent Study | Cisco Networking Academy | 3 | 3 | 61 | `Year 1/Extra/Network Course - Cisco.md` and `Extra/network/` |
| Independent Study | JavaScript Front-end | 2 | 2 | 0 | `Year0 /Extra courses/JS Frontend/` |
| Independent Study | Full-stack Web Development | 1 | 1 | 0 | `Year0 /Extra courses/Fullstack web dev/` |
| Independent Study | Kotlin | 1 | 1 | 1 | `Year2/Side Courses/Kotlin/` |
| Independent Study | Book Notes | 1 | 1 | 0 | `Uni/Books Notes/` |
| Independent Study | Other Online Courses | 3 | 3 | 7 | Google Cloud, Python course, Intro to Cybersecurity |
| — | *(unassigned)* | 1 | 1 | 0 | `Year 1/Sessions/idk.md` (empty) |
| | **Total** | **118** | **33** | **334** | |

Module and note settings:
- `code` is left empty.
- Each module's description records its source folder.
- Colours rotate through the existing palette.
- Every note gets these tags: `legacy-import`, its original year (`year-0`, `year-1` or `year-2`), `s1`/`s2` and `week-N` where the folder shows them, plus `legacy-empty` or `legacy-near-duplicate` where they apply.

## 3. The 18 flagged assignments

Weekday patterns, taken from the dated notes, were used as supporting evidence:
- Foundation Year semester 1: Computing on Tuesdays and Saturdays, group work on Wednesdays.
- Year 1 semester 2: Data Analysis on Mondays, Database on Wednesdays.
- Year 2 semester 1: Advanced Database Systems on Tuesdays, Analytics and BI on Thursdays.

| # | Source file (under `Uni/`) | Year | Default (folder/name) | Why it's uncertain | **Recommended** |
|---|---|---|---|---|---|
| 1 | `Year0 /…/FirstSemester/Session 18-10-23.md` | 2023/24 | Group Technology (Wednesday) | Heading is only "Seminar" | **Computing Foundations**: content is smartphone/technology features. *Low confidence* |
| 2 | `Year0 /…/FirstSemester/Session 01-11-23.md` | 2023/24 | Group Technology | Heading "Social Capital" | **Group Technology**: teamwork and social-capital theory, matching the group-report notes |
| 3 | `Year0 /…/FirstSemester/Session 18-11-23.md` | 2023/24 | Computing Foundations (Saturday) | Heading "Computing Group Project \| Saturday class" | **Group Technology**: essay and report structure, study skills |
| 4 | `Year0 /…/FirstSemester/Session 11-12-23.md` | 2023/24 | Computing Foundations | The only Monday session | **Computing Foundations**: heading "Computing", topic cloud computing |
| 5 | `Year0 /…/FirstSemester/Session 23-01-24.md` | 2023/24 | Computing Foundations | Empty file; weekday is the only evidence | **Computing Foundations**, tagged `legacy-empty` |
| 6 | `Year0 /…/SecondSemester/5th-week/PB/IPRSaturday.md` | 2023/24 | Problem Solving (folder) | In the `PB/` folder | **Individual Degree Related Project**: heading "Indivudal Related Project", literature-review content |
| 7 | `Year0 /…/SecondSemester/9th-week/IR.md` | 2023/24 | IDRP (prefix) | Heading only "Project details" | **IDRP**: project presentation and report |
| 8 | `Year0 /…/SecondSemester/10th-week/IPR08-05-24_.md` | 2023/24 | IDRP | Same text as `IPR08-05-24.md` apart from whitespace | **IDRP, as a separate note**, tagged `legacy-near-duplicate` (no merge) |
| 9 | `Year0 /…/Computing Maths/Maths 31-10-32.md` | 2023/24 | Computing Maths | The filename date means 2032 | **Computing Maths, dated 2023-10-31** as you approved; the original filename and the correction are recorded in the manifest |
| 10 | `Year 1/Sessions/SecondSemester/Data Analysis/05-03-2025.md` | 2024/25 | Data Analysis (folder) | Heading "Database"; content is SQL joins | **Database**: topic, heading and weekday (Wednesday) all point to Database |
| 11 | `Year2/FirstSemester/Advanced Database Systems/Sessions/30-10-2025.md` | 2025/26 | Advanced Database Systems (folder) | Heading "Decriptive Analytics" | **Analytics and Business Intelligence**: topic, and Thursday is the ABI day |
| 12 | `Year 1/Sessions/FirstSemester/Week2/Python.md` | 2024/25 | Problem Solving Through Programming | Heading "Useful Information"; one image | **PSTP**: the image is an AND/OR/NOT Boolean-logic diagram |
| 13 | `Year 1/Sessions/FirstSemester/Week1/Airbnb.md` | 2024/25 | User Experience | No date; no module prefix | **UX**: "Airbnb UI/UX Research" |
| 14 | `Year 1/Extra/python.md` | Independent | Other Online Courses | Could also be PSTP | **Other Online Courses**: it sits in `Extra/`, not in a session folder |
| 15 | `Year 1/Extra/Google.md` | Independent | Other Online Courses | One-off course | **Other Online Courses** (Google Cloud) |
| 16 | `Year0 /Extra courses/Intro to Cybersecurity/Course.md` | Independent | Other Online Courses | The "cybersecurity cube" content suggests the Cisco NetAcad course, but this isn't proven | **Other Online Courses** (it could move to Cisco Networking Academy if you confirm it was the Cisco course) |
| 17 | `readme.md` (archive root) | 2023/24 | Induction & General | A repository readme, not a lecture | **Induction & General**: it lists Year 0 semester 1 links and has 3 images |
| 18 | `Year 1/Sessions/idk.md` | 2024/25 | — | Empty; no heading or subject | **Unassigned** (no module), tagged `year-1` and `legacy-empty` |

## 4. Lecture dates: nullable `lecture_date` (your option A)

Dates come from filenames only:
- **84 notes** have a valid date.
- **1 note is corrected**: `Maths 31-10-32.md` becomes 2023-10-31.
- **33 notes** get `lecture_date = NULL`.

No other date is inferred: not from neighbouring notes, not from weekdays, and not from the ZIP timestamps.

### 4.1 Migration `0002_nullable_lecture_date`

SQLite cannot drop a `NOT NULL` constraint in place, so the `notes` table must be rebuilt. The migration follows SQLite's documented 12-step procedure:

1. `CREATE TABLE notes_new` with the same columns, but `lecture_date text` (nullable).
2. `INSERT INTO notes_new SELECT * FROM notes`. Every row, including the existing dates, is copied unchanged.
3. `DROP TABLE notes`, then `ALTER TABLE notes_new RENAME TO notes`.
4. Recreate the four indexes (`notes_user_updated_idx`, `notes_user_lecture_idx`, `notes_module_idx`, `notes_source_hash_idx`).

**Compatibility risk, and how it is handled.** The connection runs with `foreign_keys = ON`. With foreign keys on, `DROP TABLE notes` would **cascade-delete** `note_versions` and `note_tags`, and **null out** `attachments.note_id`. Drizzle's migrator runs inside a transaction, where `PRAGMA foreign_keys` cannot be changed. So `runMigrations()` (`src/db/migrations.ts`) will be changed to:
- turn `foreign_keys` off **before** the migrator starts;
- run `PRAGMA foreign_key_check` afterwards and abort on any violation;
- turn foreign keys back on.

This change is covered by a new test that runs the migration on a seeded database and asserts that versions, tags, attachments and FTS rows survive.

Other effects:
- `notes_fts` is a standalone table keyed by `note_id` and is unaffected.
- The data change is backwards-compatible: existing rows keep their dates.
- The **code** change is not backwards-compatible. Once NULLs exist, an older build of the app would crash when it meets them. Roll back only by restoring the pre-migration backup.

Migration procedure:
1. Stop the dev server.
2. Run `npm run backup` and verify the backup.
3. Run `npm run db:migrate`.
4. Check row counts and `foreign_key_check`.

### 4.2 Application changes

| Area | Change |
|---|---|
| `schema.ts` | `lectureDate: text('lecture_date')` (drop `.notNull()`) |
| Notes API (`notes.routes.ts`) | Create and patch accept `lectureDate: dateOnly.nullable()`. The field stays required on create, so a client must send a date or an explicit `null`. The editor still pre-fills today for new notes, so creating a note works as it does now. The response type becomes `string \| null`. `openapi.json` is regenerated |
| Sorting (`queryNotes`) | `lecture_desc` and `lecture_asc` both use `NULLS LAST`, so undated notes always come after dated ones. The default "updated" and "relevance" sorts are unaffected |
| Filters | `date` / `from` / `to` naturally exclude NULLs. The module, year, tag and search filters include undated notes |
| Calendar (`calendar.routes.ts`) | `BETWEEN` already excludes NULLs, so undated notes simply don't appear. No change beyond a test |
| Dashboard | Recent notes are sorted by `updated_at`; only the date label changes |
| Frontend types, `NoteCard`, `QuickSearch` | `lectureDate: string \| null`; the label shows "Undated" |
| Editor (`NoteEditorPage`) | The date input is no longer `required`. Clearing it sets `null`, and choosing a date assigns one at any time |
| Markdown import (`POST /api/import`, `ImportDialog`) | The date becomes optional (blank means NULL). The UI keeps today as its default |
| Export (`export.service.ts`) | Front matter writes `lecture_date: null`. File names become `undated-<slug>.md` instead of `<date>-<slug>.md`. ZIP ordering uses `NULLS LAST`. Re-importing a UniNotes export reads `null` back as NULL |
| Tests | `helpers.ts`, `notes.test.ts`, `import-export.test.ts`, `hardening.test.ts`, `migrations.test.ts`, `CalendarPage.test.tsx` and `useAutosave.test.tsx` are updated, with new cases for NULL sort order, calendar exclusion, export of undated notes, the editor clearing a date, and migration data preservation |

## 5. Source code as download-only attachments

### 5.1 Can the attachment system support this safely? Yes, with a small change and no schema change

The existing design already contains what this needs:
- Attachments have `kind: 'image' | 'file'`.
- `file` attachments are **always** served with `Content-Disposition: attachment`, plus `Content-Security-Policy: default-src 'none'; … sandbox`, plus helmet's `X-Content-Type-Options: nosniff`.
- The editor's Files panel already lists `file` attachments with a download button.
- Export already includes every attachment a note owns or references.

**Proposed change.** Add a third accepted type, *source text*, to the shared validator in `attachments.service.ts`:

| Control | Rule |
|---|---|
| Extension allow-list | `.c`, `.h`, `.py`, `.js`, `.ts`, `.html` (`.h` included for C headers; none exist in this archive) |
| Content checks | Must decode as strict UTF-8; no NUL bytes; `file-type` must detect **no** binary format (rejects disguised executables, archives and images) |
| Size | At most 1 MB per file (new constant; the largest file here is 3.4 KB) |
| Storage | Bytes stored **exactly as received**, with no re-encoding; `sha256` is computed on the original bytes; opaque random storage key; file mode `0600` |
| Stored type | `kind = 'file'`, `mime_type = 'text/plain'`, whatever the extension. Never `text/html` or `application/javascript` |
| Serving | Unchanged route: always a download, `text/plain`, `nosniff`, sandbox CSP. An `.html` file therefore can never render or run in the browser |
| Ownership | Unchanged: `user_id` plus `getOwnedAttachment`, with the note checked by `getOwnedNote` |
| Image and PDF paths | Untouched. The new branch runs only when the bytes are neither a supported image nor a PDF and the extension is allow-listed |

**Decision for you:** enable source-text uploads in the **editor UI** too (the Files panel and its `accept` list), or keep them **importer-only** for now. I recommend enabling them in the UI as well: the checks are the same either way, and you will be able to add code to notes later.

**Limits:**
- The attachment's `original_name` keeps the **filename**, sanitised.
- The full **source path** is kept in the manifest and in the host note's file list (§5.2), because `attachments` has no metadata column. Adding one would mean another schema change, which I'm not proposing.
- Code inside attachments is not full-text indexed. The filenames and paths in the host note are.

### 5.2 Where the files attach

Every attachment needs a host note, and `attachments` has no module link. Of the 51 source files, a reliable one-to-one note relationship exists only for a few: for example `Week1/Text.py` with `PSTP141024.md`. Most folders have several candidate notes, or none: there are 7 C week folders without a PB note, and `PB-Assesment/` has no note at all.

**Recommended: one generated "Source files" note per module that has code.** That is **6 notes** in total, instead of the 18 in revision 1:

| Generated note | Module | Files |
|---|---|---|
| Problem Solving — Source files | Problem Solving | 45 `.c` files, grouped under one heading per original folder (`1st-week` … `12th-week`, `PB-Assesment`). Where a week has a PB note, its heading names it |
| Web Technologies — Source files | Web Technologies | `ajax.html`, `script.js` |
| PSTP — Source files | Problem Solving Through Programming | `Text.py` |
| Other Online Courses — Source files | Other Online Courses | `test.py` |
| JavaScript Front-end — Source files | JavaScript Front-end | `index.html` |
| Web Application Development — Source files | Web Application Development | `grade.ts` |

Each generated note:
- holds a list of `[📎 <original path>](/api/attachments/<id>/content?download=1)` links;
- is tagged `legacy-import` and `source-files`;
- has `lecture_date` NULL;
- is clearly labelled as generated by the import.

**None of the 118 original notes is modified to add links.** *Alternative:* attach a file to an existing note where exactly one same-subject note sits in the same folder, and use the generated notes only for the rest. That splits files between two places.

Never imported, and each listed in the manifest with its reason:
- the **41 ELF executables**;
- the **4 repository metadata files**.

## 6. Images

- Every one of the 334 references is resolved against the note's own folder. The repeated `image*.png` names never cross folders.
- **The root-relative rule:** a reference starting with `/` is first tried at the archive root (`Uni-test/`). If it isn't found there, and the path starts `/Uni/<rest>`, it is tried as `Uni/<Year folder>/<rest>` under the note's own year folder. A match is accepted only when **exactly one** file fits. This resolves `/Uni/Sessions/Computing/resources/von.png` to `Uni/Year0 /Sessions/Computing/resources/von.png`, and the remap is recorded.
- Each unique source image becomes one attachment, owned by `switchback`, with its `note_id` set to the first note that uses it. The four `10th-week` images shared by both `IPR08-05-24` notes are referenced, not duplicated. Export already handles referenced attachments.
- **What the existing image pipeline does** (sharp):
  - decodes and re-encodes every PNG losslessly, at compression level 9;
  - strips metadata;
  - leaves pixel dimensions unchanged, except for one image.
- **The one resized image:** `Uni/Year0 /Sessions/Computing/FirstSemester/image.png`, 5405×3901 RGB, is downscaled to **4096×2956**. It is used by `Session 16-01-24.md` (Computing Foundations). This is recorded in the manifest with both sizes.
- **Keeping the original:** I recommend **not** storing a second, unprocessed copy inside UniNotes. Re-encoding is a deliberate security control: it removes hidden payloads and metadata from anything served inline. Storing the original as a downloadable `file` would sidestep that, and would show up as a duplicate in the Files panel. The untouched original stays in `Imports/Uni-test.zip`, whose checksum the manifest records, and it should be kept with your backups.
- The Markdown files and images inside the archive are never modified. Only the copies in the database are rewritten.

## 7. Source → destination mapping (all 118 Markdown files)

How the table columns are filled:
- **Title:** the first `# ` heading if there is one, otherwise the first heading of any level, otherwise the filename.
- **Lecture date:** **NULL** = no date in the filename.
- **⚠** marks one of the 18 flagged rows from §3. Each one shows its recommended assignment.

#### 2023/24

| # | Source path | Module | Sem/Wk | Proposed title | Lecture date | Img | Review |
|---|---|---|---|---|---|---|---|
| 1 | `Uni/Year0 /InductionsYear0/Induction0 03-10-23.md` | Foundation Year Induction & General | — | Contents | 2023-10-03 | 0 |  |
| 2 | `Uni/Year0 /InductionsYear0/Induction1 10-10-23.md` | Foundation Year Induction & General | — | Session 1 - When things go wrong | 2023-10-10 | 0 |  |
| 3 | `Uni/Year0 /InductionsYear0/Induction2 11-10-23.md` | Foundation Year Induction & General | — | Extenuating Circumstances | 2023-10-11 | 0 |  |
| 4 | `Uni/Year0 /InductionsYear0/Induction3 14-10-23.md` | Foundation Year Induction & General | — | Ace Team Induction | 2023-10-14 | 0 |  |
| 5 | `readme.md` | Foundation Year Induction & General | — | This repository is for University resoucers/notes only. | NULL | 3 | ⚠ Repository readme (Year 0 links + 3 images). Recommended Induction & General. |
| 6 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 02-01-24.md` | Computing Foundations | S1 | Computing \| back from the holidays | 2024-01-02 | 0 |  |
| 7 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 04-11-23.md` | Computing Foundations | S1 | Computing \| Saturday class \| week 3 | 2023-11-04 | 1 |  |
| 8 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 05-12-23.md` | Computing Foundations | S1 | Computing | 2023-12-05 | 0 |  |
| 9 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 11-11-23.md` | Computing Foundations | S1 | Computing \| Saturday class | 2023-11-11 | 0 |  |
| 10 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 11-12-23.md` | Computing Foundations | S1 | Computing | 2023-12-11 | 0 | ⚠ Only Monday session; heading "Computing", topic cloud computing; recommended CF. |
| 11 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 14-11-23.md` | Computing Foundations | S1 | Computing | 2023-11-14 | 0 |  |
| 12 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 16-01-24.md` | Computing Foundations | S1 | Computing | 2024-01-16 | 4 |  |
| 13 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 17-10-23.md` | Computing Foundations | S1 | Computing Foundations | 2023-10-17 | 0 |  |
| 14 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 18-10-23.md` | Computing Foundations | S1 | Seminar | 2023-10-18 | 0 | ⚠ Heading only "Seminar" (Wed, week 1). Content (smartphone features) fits Computing Foundations; recommended CF. |
| 15 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 21-10-23.md` | Computing Foundations | S1 | Computing | 2023-10-21 | 0 |  |
| 16 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 21-11-23.md` | Computing Foundations | S1 | Computing | 2023-11-21 | 0 |  |
| 17 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 23-01-24.md` | Computing Foundations | S1 | Session 23-01-24 | 2024-01-23 | 0 | ⚠ Empty file; Tuesday = Computing Foundations day (weekday evidence only). |
| 18 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 24-10-23.md` | Computing Foundations | S1 | Computing | 2023-10-24 | 0 |  |
| 19 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 28-10-23.md` | Computing Foundations | S1 | Computing | 2023-10-28 | 0 |  |
| 20 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 31-10-23.md` | Computing Foundations | S1 | Computer | 2023-10-31 | 0 |  |
| 21 | `Uni/Year0 /Sessions/Computing/FirstSemester/Review 10-01-24.md` | Group Technology Project | S1 | Group Tech Review | 2024-01-10 | 0 |  |
| 22 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 01-11-23.md` | Group Technology Project | S1 | Social Capital | 2023-11-01 | 0 | ⚠ Heading "Social Capital" (Wed). Teamwork/social-capital theory matches the group-work report notes; recommended GT. |
| 23 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 03-01-24.md` | Group Technology Project | S1 | Group Technology | 2024-01-03 | 0 |  |
| 24 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 08-11-23.md` | Group Technology Project | S1 | Group Project | 2023-11-08 | 0 |  |
| 25 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 13-12-23.md` | Group Technology Project | S1 | Group technology | 2023-12-13 | 0 |  |
| 26 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 15-11-23.md` | Group Technology Project | S1 | Group Project | 2023-11-15 | 0 |  |
| 27 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 17-01-24.md` | Group Technology Project | S1 | Group technology | 2024-01-17 | 0 |  |
| 28 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 18-11-23.md` | Group Technology Project | S1 | Computing Group Project\| Saturday class | 2023-11-18 | 0 | ⚠ Saturday, but heading "Computing Group Project" and essay/report content; recommended GT. |
| 29 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 22-11-23.md` | Group Technology Project | S1 | Group Technology project | 2023-11-22 | 0 |  |
| 30 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 25-10-23.md` | Group Technology Project | S1 | Group Project | 2023-10-25 | 0 |  |
| 31 | `Uni/Year0 /Sessions/Computing/FirstSemester/Session 25-11-23.md` | Group Technology Project | S1 | Group Project \| Saturday Class | 2023-11-25 | 0 |  |
| 32 | `Uni/Year0 /Sessions/Computing/FirstSemester/Computing Maths/Maths 01-11-23.md` | Computing Maths | S1 | What is formula | 2023-11-01 | 0 |  |
| 33 | `Uni/Year0 /Sessions/Computing/FirstSemester/Computing Maths/Maths 17-10-23.md` | Computing Maths | S1 | Foundation Maths \| Second lesson | 2023-10-17 | 0 |  |
| 34 | `Uni/Year0 /Sessions/Computing/FirstSemester/Computing Maths/Maths 24-10-23.md` | Computing Maths | S1 | Maths | 2023-10-24 | 0 |  |
| 35 | `Uni/Year0 /Sessions/Computing/FirstSemester/Computing Maths/Maths 31-10-32.md` | Computing Maths | S1 | Algebra | 2023-10-31 (corrected) | 0 | ⚠ Filename date 31-10-32 (= 2032). Corrected to 2023-10-31 per your approval; original filename kept in manifest. |
| 36 | `Uni/Year0 /Sessions/Computing/FirstSemester/Computing Maths/Maths-General-Notes.md` | Computing Maths | S1 | Here I store general Maths notes | NULL | 0 |  |
| 37 | `Uni/Year0 /Sessions/Computing/SecondSemester/10th-week/MD07-05-24.md` | Digital Media Technologies | S2/W10 | Digital Media | 2024-05-07 | 7 |  |
| 38 | `Uni/Year0 /Sessions/Computing/SecondSemester/11th-week/DM14-05-24.md` | Digital Media Technologies | S2/W11 | Digital Media | 2024-05-14 | 7 |  |
| 39 | `Uni/Year0 /Sessions/Computing/SecondSemester/1st-week/DM Session13-02-24.md` | Digital Media Technologies | S2/W1 | Digital Media Technologies \| first session | 2024-02-13 | 0 |  |
| 40 | `Uni/Year0 /Sessions/Computing/SecondSemester/1st-week/Seminar17-02-24.md` | Digital Media Technologies | S2/W1 | Digital Media Technologies | 2024-02-17 | 0 |  |
| 41 | `Uni/Year0 /Sessions/Computing/SecondSemester/2nd-week/DM 20-02-24.md` | Digital Media Technologies | S2/W2 | Digital Media | 2024-02-20 | 0 |  |
| 42 | `Uni/Year0 /Sessions/Computing/SecondSemester/3rd-week/DM27-02-24.md` | Digital Media Technologies | S2/W3 | Digital Media Tech | 2024-02-27 | 0 |  |
| 43 | `Uni/Year0 /Sessions/Computing/SecondSemester/4th-week/DM05-03-24.md` | Digital Media Technologies | S2/W4 | Digital media | 2024-03-05 | 0 |  |
| 44 | `Uni/Year0 /Sessions/Computing/SecondSemester/5th-week/MD12-03-24.md` | Digital Media Technologies | S2/W5 | Digital Media | 2024-03-12 | 1 |  |
| 45 | `Uni/Year0 /Sessions/Computing/SecondSemester/6th-week/DM19-03-24.md` | Digital Media Technologies | S2/W6 | Digital Media Tech | 2024-03-19 | 0 |  |
| 46 | `Uni/Year0 /Sessions/Computing/SecondSemester/7th-week/DM16-04-24.md` | Digital Media Technologies | S2/W7 | Digital Media Tech | 2024-04-16 | 3 |  |
| 47 | `Uni/Year0 /Sessions/Computing/SecondSemester/9th-week/DM30-04-24.md` | Digital Media Technologies | S2/W9 | Digital Media | 2024-04-30 | 4 |  |
| 48 | `Uni/Year0 /Sessions/Computing/SecondSemester/11th-week/PB.md` | Problem Solving | S2/W11 | Problem Solving | NULL | 5 |  |
| 49 | `Uni/Year0 /Sessions/Computing/SecondSemester/1st-week/PB Session13-02-24.md` | Problem Solving | S2/W1 | Problem Solving - first session | 2024-02-13 | 3 |  |
| 50 | `Uni/Year0 /Sessions/Computing/SecondSemester/2nd-week/PB20-02-24.md` | Problem Solving | S2/W2 | Problem Solving | 2024-02-20 | 2 |  |
| 51 | `Uni/Year0 /Sessions/Computing/SecondSemester/2nd-week/PBSeminar.md` | Problem Solving | S2/W2 | Problem solving | NULL | 0 |  |
| 52 | `Uni/Year0 /Sessions/Computing/SecondSemester/3rd-week/PB27-02-24.md` | Problem Solving | S2/W3 | Problem Solving | 2024-02-27 | 0 |  |
| 53 | `Uni/Year0 /Sessions/Computing/SecondSemester/5th-week/PB/PB12-03-24.md` | Problem Solving | S2/W5 | PB12-03-24 | 2024-03-12 | 0 |  |
| 54 | `Uni/Year0 /Sessions/Computing/SecondSemester/10th-week/IPR08-05-24.md` | Individual Degree Related Project | S2/W10 | Individual Related Project | 2024-05-08 | 4 |  |
| 55 | `Uni/Year0 /Sessions/Computing/SecondSemester/10th-week/IPR08-05-24_.md` | Individual Degree Related Project | S2/W10 | Individual Related Project | 2024-05-08 | 4 | ⚠ Near-duplicate of IPR08-05-24.md (whitespace-only differences). Recommended: separate note, tagged legacy-near-duplicate. |
| 56 | `Uni/Year0 /Sessions/Computing/SecondSemester/11th-week/IDRP15-05-24.md` | Individual Degree Related Project | S2/W11 | Indivual Related | 2024-05-15 | 9 |  |
| 57 | `Uni/Year0 /Sessions/Computing/SecondSemester/1st-week/IDRP Session14-02-24.md` | Individual Degree Related Project | S2/W1 | Individual Degree Related Project | 2024-02-14 | 2 |  |
| 58 | `Uni/Year0 /Sessions/Computing/SecondSemester/2nd-week/IRP21-02-24.md` | Individual Degree Related Project | S2/W2 | Individual Project Related | 2024-02-21 | 2 |  |
| 59 | `Uni/Year0 /Sessions/Computing/SecondSemester/2nd-week/IRPSeminar.md` | Individual Degree Related Project | S2/W2 | Individual related project | NULL | 0 |  |
| 60 | `Uni/Year0 /Sessions/Computing/SecondSemester/3rd-week/IDPR28-02-24.md` | Individual Degree Related Project | S2/W3 | Individual Degree Related Project | 2024-02-28 | 2 |  |
| 61 | `Uni/Year0 /Sessions/Computing/SecondSemester/5th-week/IDPR130324.md` | Individual Degree Related Project | S2/W5 | Reports and essays structure | 2024-03-13 | 3 |  |
| 62 | `Uni/Year0 /Sessions/Computing/SecondSemester/5th-week/PB/IPRSaturday.md` | Individual Degree Related Project | S2/W5 | Indivudal Related Project | NULL | 0 | ⚠ Stored in 5th-week/PB/ but heading is "Indivudal Related Project". Literature-review content; recommended IDRP. |
| 63 | `Uni/Year0 /Sessions/Computing/SecondSemester/6th-week/IRPD20-03-24.md` | Individual Degree Related Project | S2/W6 | Project Managment - again D: | 2024-03-20 | 5 |  |
| 64 | `Uni/Year0 /Sessions/Computing/SecondSemester/7th-week/IDRP17-04-24.md` | Individual Degree Related Project | S2/W7 | Individual Degree Related Project | 2024-04-17 | 11 |  |
| 65 | `Uni/Year0 /Sessions/Computing/SecondSemester/8th-week/IDPR240424.md` | Individual Degree Related Project | S2/W8 | Individual Project related | 2024-04-24 | 0 |  |
| 66 | `Uni/Year0 /Sessions/Computing/SecondSemester/9th-week/IR.md` | Individual Degree Related Project | S2/W9 | Project details | NULL | 0 | ⚠ Heading "Project details" (project presentation/report); recommended IDRP. |

#### 2024/25

| # | Source path | Module | Sem/Wk | Proposed title | Lecture date | Img | Review |
|---|---|---|---|---|---|---|---|
| 67 | `Uni/Year 1/Sessions/FirstSemester/Week1/NET141024.md` | Networking | S1/W1 | Intro to networks | 2024-10-14 | 12 |  |
| 68 | `Uni/Year 1/Sessions/FirstSemester/Week2/Net.md` | Networking | S1/W2 | Assessment Information | NULL | 28 |  |
| 69 | `Uni/Year 1/Sessions/FirstSemester/Week2/Net261024.md` | Networking | S1/W2 | Networks | 2024-10-26 | 0 |  |
| 70 | `Uni/Year 1/Sessions/FirstSemester/Week3/Net281024.md` | Networking | S1/W3 | Network | 2024-10-28 | 9 |  |
| 71 | `Uni/Year 1/Sessions/FirstSemester/Week3/Seminar-NET.md` | Networking | S1/W3 | IP Address | NULL | 0 |  |
| 72 | `Uni/Year 1/Sessions/FirstSemester/week8/NET.md` | Networking | S1/W8 | Network | NULL | 0 |  |
| 73 | `Uni/Year 1/Sessions/FirstSemester/Week1/Airbnb.md` | User Experience (UX) | S1/W1 | Airbnb UI/UX Research | NULL | 0 | ⚠ Year 1 Week 1 "Airbnb UI/UX Research". Recommended UX. |
| 74 | `Uni/Year 1/Sessions/FirstSemester/Week1/UX161024.md` | User Experience (UX) | S1/W1 | User Experience | 2024-10-16 | 1 |  |
| 75 | `Uni/Year 1/Sessions/FirstSemester/Week2/UX231024.md` | User Experience (UX) | S1/W2 | Objectives | 2024-10-23 | 4 |  |
| 76 | `Uni/Year 1/Sessions/FirstSemester/Week3/UX.md` | User Experience (UX) | S1/W3 | Double Diamond | NULL | 6 |  |
| 77 | `Uni/Year 1/Sessions/FirstSemester/Week4/UX.md` | User Experience (UX) | S1/W4 | UX | NULL | 3 |  |
| 78 | `Uni/Year 1/Sessions/FirstSemester/week6/ux201124.md` | User Experience (UX) | S1/W6 | UX | 2024-11-20 | 3 |  |
| 79 | `Uni/Year 1/Sessions/FirstSemester/week8/UX.md` | User Experience (UX) | S1/W8 | User Experience | NULL | 0 |  |
| 80 | `Uni/Year 1/Sessions/FirstSemester/Week1/PSTP141024.md` | Problem Solving Through Programming | S1/W1 | Problem Solving Through Programming Introduction | 2024-10-14 | 0 |  |
| 81 | `Uni/Year 1/Sessions/FirstSemester/Week2/Python.md` | Problem Solving Through Programming | S1/W2 | Useful Information | NULL | 1 | ⚠ Year 1 Week 2 "Useful Information" (Python). Single Boolean-logic diagram; recommended PSTP. |
| 82 | `Uni/Year 1/Sessions/SecondSemester/Data Analysis/10-02-2025.md` | Data Analysis | S2 | Data Analytics | 2025-02-10 | 12 |  |
| 83 | `Uni/Year 1/Sessions/SecondSemester/Data Analysis/17-02-2025.md` | Data Analysis | S2 | Data Collection | 2025-02-17 | 10 |  |
| 84 | `Uni/Year 1/Sessions/SecondSemester/Data Analysis/22-02-2025.md` | Data Analysis | S2 | Data Analysis | 2025-02-22 | 0 |  |
| 85 | `Uni/Year 1/Sessions/SecondSemester/Data Analysis/05-03-2025.md` | Database | S2 | Database | 2025-03-05 | 2 | ⚠ In Data Analysis folder, but heading "Database", SQL joins, and Wednesday = Database day; recommended move to Database. |
| 86 | `Uni/Year 1/Sessions/SecondSemester/Database/02-04-2025.md` | Database | S2 | Database | 2025-04-02 | 1 |  |
| 87 | `Uni/Year 1/Sessions/SecondSemester/Database/19-02-2025.md` | Database | S2 | Introduction to Databases | 2025-02-19 | 3 |  |
| 88 | `Uni/Year 1/Sessions/SecondSemester/Database/SQL.md` | Database | S2 | SQL Commands and stuff | NULL | 2 |  |
| 89 | `Uni/Year 1/Sessions/SecondSemester/Web/12-02-25.md` | Web Technologies | S2 | Web Tech | 2025-02-12 | 2 |  |
| 90 | `Uni/Year 1/Sessions/SecondSemester/Web/24-02-25.md` | Web Technologies | S2 | Web Tech | 2025-02-24 | 2 |  |

#### 2025/26

| # | Source path | Module | Sem/Wk | Proposed title | Lecture date | Img | Review |
|---|---|---|---|---|---|---|---|
| 91 | `Uni/Year2/FirstSemester/Advanced Database Systems/14-10-2025.md` | Advanced Database Systems | S1 | Advanced Database Systems | 2025-10-14 | 2 |  |
| 92 | `Uni/Year2/FirstSemester/Advanced Database Systems/Sessions/11-11-2025.md` | Advanced Database Systems | S1 | 11-11-2025 | 2025-11-11 | 2 |  |
| 93 | `Uni/Year2/FirstSemester/Advanced Database Systems/Sessions/Info.md` | Advanced Database Systems | S1 | Normalisation | NULL | 39 |  |
| 94 | `Uni/Year2/FirstSemester/Advanced Database Systems/Sessions/30-10-2025.md` | Analytics and Business Intelligence | S1 | Decriptive Analytics | 2025-10-30 | 0 | ⚠ In ADS folder, but heading "Decriptive Analytics" and Thursday = ABI day (ADS is Tuesday); recommended move to ABI. |
| 95 | `Uni/Year2/FirstSemester/Analytics and Business Intelligence/13-11-25.md` | Analytics and Business Intelligence | S1 | 13-11-25 | 2025-11-13 | 4 |  |
| 96 | `Uni/Year2/FirstSemester/Analytics and Business Intelligence/16-10-25.md` | Analytics and Business Intelligence | S1 | Analytics and Business Intelligence | 2025-10-16 | 5 |  |
| 97 | `Uni/Year2/FirstSemester/Analytics and Business Intelligence/Report/Week1.md` | Analytics and Business Intelligence | S1 | Week 1 | NULL | 4 |  |
| 98 | `Uni/Year2/FirstSemester/Object Oriented Design and Dev/16-10-25.md` | Object-Oriented Design and Development | S1 | Loops | 2025-10-16 | 9 |  |
| 99 | `Uni/Year2/FirstSemester/Object Oriented Design and Dev/Sessions/13-11-25.md` | Object-Oriented Design and Development | S1 | 13-11-25 | 2025-11-13 | 2 |  |
| 100 | `Uni/Year2/FirstSemester/Object Oriented Design and Dev/Sessions/14-10-2025.md` | Object-Oriented Design and Development | S1 | Object Oriented Design and Development | 2025-10-14 | 6 |  |
| 101 | `Uni/Year2/FirstSemester/Object Oriented Design and Dev/Sessions/OOP.md` | Object-Oriented Design and Development | S1 | Object Oriented Logic Study | NULL | 8 |  |
| 102 | `Uni/Year2/SecondSemester/HCI/21-02-26.md` | Human-Computer Interaction (HCI) | S2 | Human Computer Interactions | 2026-02-21 | 0 |  |
| 103 | `Uni/Year2/SecondSemester/Reasearch Methods/05-03-26.md` | Research Methods | S2 | 05-03-26 | 2026-03-05 | 0 |  |
| 104 | `Uni/Year2/SecondSemester/WebAppDev/21-02-26.md` | Web Application Development | S2 | 21-02-26 | 2026-02-21 | 1 |  |
| 105 | `Uni/Year2/SecondSemester/WebAppDev/react-refresh.md` | Web Application Development | S2 | React JS Refresh | NULL | 0 |  |
| 106 | `Uni/Year2/SecondSemester/WebAppDev/react-typescript.md` | Web Application Development | S2 | React + TypeScript Quick Refresh | NULL | 0 |  |

#### Independent Study

| # | Source path | Module | Sem/Wk | Proposed title | Lecture date | Img | Review |
|---|---|---|---|---|---|---|---|
| 107 | `Uni/Year 1/Extra/Network Course - Cisco.md` | Cisco Networking Academy | — | Network Course on Cisco Academy | NULL | 21 |  |
| 108 | `Uni/Year 1/Extra/network/Network 2.md` | Cisco Networking Academy | — | Cisco IOS Access | NULL | 23 |  |
| 109 | `Uni/Year 1/Extra/network/network3.md` | Cisco Networking Academy | — | Network Module 3 | NULL | 17 |  |
| 110 | `Uni/Year0 /Extra courses/JS Frontend/Bootstrap.md` | JavaScript Front-end | — | Bootstrap | NULL | 0 |  |
| 111 | `Uni/Year0 /Extra courses/JS Frontend/DOM.md` | JavaScript Front-end | — | Manipulating Pages | NULL | 0 |  |
| 112 | `Uni/Year0 /Extra courses/Fullstack web dev/Fullstack course note.md` | Full-stack Web Development | — | Web development essentials | NULL | 0 |  |
| 113 | `Uni/Year2/Side Courses/Kotlin/PT-1.md` | Kotlin | — | Kotlin | NULL | 1 |  |
| 114 | `Uni/Books Notes/UX Experience.md` | Book Notes | — | Communicating The UX Experience | NULL | 0 |  |
| 115 | `Uni/Year 1/Extra/Google.md` | Other Online Courses | — | Google Cloud | NULL | 2 | ⚠ Year 1 extra course (Google Cloud). Recommended Other Online Courses. |
| 116 | `Uni/Year 1/Extra/python.md` | Other Online Courses | — | Python Course | NULL | 1 | ⚠ Year 1 extra "Python Course". In Extra/ (not a session); recommended Other Online Courses. |
| 117 | `Uni/Year0 /Extra courses/Intro to Cybersecurity/Course.md` | Other Online Courses | — | Cybersecurity | NULL | 4 | ⚠ Year 0 extra "Intro to Cybersecurity". Cybersecurity-cube content suggests Cisco NetAcad, unproven; recommended Other Online Courses. |

#### Unassigned

| # | Source path | Module | Sem/Wk | Proposed title | Lecture date | Img | Review |
|---|---|---|---|---|---|---|---|
| 118 | `Uni/Year 1/Sessions/idk.md` | — (unassigned) | — | idk | NULL | 0 | ⚠ Empty file, no heading, only Year 1 context. Recommended: unassigned (no module), year-1 tag. |

## 8. Revised migration plan

Nothing in this plan starts until you approve it.

**Phase A — schema change** (needs your approval of §4):
1. Take a backup with `npm run backup`, and verify it.
2. Add migration `0002_nullable_lecture_date` and the FK-safe change to `runMigrations`.
3. Make the application and test changes in §4.2.
4. Run the full backend and frontend test suites. Run the migration first on a **copy** of the database, then on the real one.

**Phase B — source-text attachments** (needs your approval of §5): the validator branch, tests (including disguised-binary, non-UTF-8, `.html`-served-as-download and ownership cases), and the UI `accept` list if you choose that.

**Phase C — the importer**, in `Backend/scripts/import-legacy.ts`, run as `npm run import:legacy`:
- **Inputs:**
  - `--zip`;
  - `--username switchback` (the ID is looked up at run time);
  - `--mapping` (the approved §7 as JSON);
  - `--dry-run`;
  - `--manifest <out>`.
- **Reading the ZIP:** streamed with `yauzl` (moved from dev to runtime dependencies; already in the lockfile). It rejects:
  - traversal, absolute paths and symlinks;
  - encrypted entries;
  - oversize entries, and more than 200 MB in total;
  - entries whose inflated size doesn't match the size they declare.

  Nothing from the archive is executed.
- **Reuse of existing code:** `createNote` (which writes the note, its tags, an `import` version and the FTS row in one transaction), `decodeMarkdown`, and the attachment validators.
- **Transactions:** one per note, covering the note, its attachments and its index row. Files are written first and removed again if the transaction fails.
- **Idempotency:** `source_hash` is set to `sha256("uninotes-legacy:v1\n" + sourcePath + "\n" + sha256(bytes))`.
  - The check includes soft-deleted notes, so deleting an imported note never brings it back on a re-run.
  - A matching note is reported as `already-imported` and never updated.
  - Modules are matched by name and year.
- **Never:** creates users, modifies existing notes, or deletes anything.

**Phase D — dry run.** The database is opened read-only. The report shows:
- the resolved user and ID;
- 25 modules to create and 0 to reuse;
- 118 + 6 notes;
- 330 images and 51 source files;
- 45 excluded files;
- missing references (expected: 0);
- 33 NULL dates and 1 corrected date;
- conflicts.

It also writes the planned manifest. **Then I stop for your approval.**

**Phase E — the real import** (after approval):
1. Backup.
2. Check the archive checksum.
3. Import.
4. Verify:
   - note ownership;
   - foreign keys;
   - attachment references;
   - FTS row counts;
   - no duplicates;
   - the existing Data Science module and Test note unchanged;
   - a second dry run reports everything as `already-imported`;
   - the checksum after the import.
5. Then the in-app checks from the brief.

**Expected database changes**, from the dry-run estimate:
- +25 modules;
- +124 notes, each with an `import` version and an FTS row;
- +381 attachments: 330 images and 51 source files;
- new tags: `legacy-import`, `year-0`/`year-1`/`year-2`, `s1`/`s2`, `week-1`…`week-12`, `legacy-empty`, `legacy-near-duplicate`, `source-files`.

## 9. Transformations applied to note copies (recorded per note)

1. Image references are rewritten to `/api/attachments/<id>/content`, keeping the alt text. The `von.png` remap is part of this.
2. `Maths-General-Notes.md`: the HTML `<h1 style='color:red'> Here I store general Maths notes</h1>` becomes `# Here I store general Maths notes`. Without this change, the renderer, which skips raw HTML, would hide the note's only heading. *Please confirm.*

3. `react-typescript.md`: the 7 chat-tool citation markers are removed (approved). Only the markers, and the single space before each, are removed.
4. **Approved 2026-10-20:** `10th-week/IPR08-05-24.md` and `IPR08-05-24_.md`, lines 5–7. The broken markup `![` / whitespace line / `](image-9.png)` becomes `![](image-9.png)`, so that `image-9.png` displays. As written, it never rendered as an image (`LEGACY_NOTES_ANALYSIS.md` §5.1).

Everything else is byte-for-byte.

## 10. Decisions

Approved on 2026-10-20:
- the nullable `lecture_date` migration and app changes (§4);
- source-code attachments, including uploads from the editor (§5);
- the six generated "Source files" notes (§5.2);
- all 18 recommendations (§3);
- transformations 1–3 in §9 (image references, the Maths heading, the citation markers);
- the image strategy and the one downscale (§6).

Approved on 2026-10-20 as well: the dry run, and transformation 4 (the `image-9.png` repair). The import has been carried out.
