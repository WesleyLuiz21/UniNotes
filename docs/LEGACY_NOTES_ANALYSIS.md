# Legacy University Notes — Archive Analysis

Status: **Phase 1 complete, revision 3**. Revision 3 corrects the image-reference count (§5.1), which the importer's dry run found to be wrong. No legacy notes have been imported.
Analysis date: 2026-10-20. Revision 2 corrects §8 (the database was found) and adds §4.1 (citation passages).

## 1. Source archive

| Property | Value |
|---|---|
| Path | `/workspaces/UniNotes/Imports/Uni-test.zip` (the `Imports/` folder is in `.gitignore`) |
| Size | 55,429,865 bytes |
| SHA-256 | `c3547a918b210e1d1ec2e4760d8ad194072c6f4a919b22aaab1753f35d962b07` |
| ZIP entries | 603 (59 directories + 544 files) |
| Uncompressed / compressed data | 57,289,341 / 55,294,657 bytes |
| Top-level folder | `Uni-test/` (all paths below are relative to it) |

How the archive was inspected: entries were listed with Python's `zipfile`, then extracted into a separate, write-protected scratch directory outside the repository. Nothing in the archive was executed.

### 1.1 Archive safety checks

| Check | Result |
|---|---|
| Absolute paths, `..` segments, backslashes | None |
| Symlinks | None |
| Encrypted entries | None |
| Highest compression ratio | 5.2:1 (a compiled binary). No sign of a decompression bomb |
| Non-ASCII filenames | None |
| Path components with leading/trailing whitespace | One: `Year0 ` (trailing space) |
| Hidden files | `.vscode/settings.json` and `.vscode/tasks.json` (editor config) |

## 2. File inventory (verified)

| Type | Count | Notes |
|---|---:|---|
| Markdown `.md` | **118** | All valid UTF-8, no BOM, LF line endings. 4 are empty (0 bytes) |
| PNG `.png` | **330** | All are real PNG data (checked with `file`). 326 RGBA and 4 RGB. 56.3 MB in total |
| C source `.c` | 45 | Programming exercises from Foundation Year semester 2 (Problem Solving) |
| Compiled executables (no extension) | 41 | ELF 64-bit binaries built from the `.c` files. 40 have a matching `.c`; `PB-Assesment/Assesment1` has no source |
| Python `.py` | 2 | `Year 1/Extra/test.py`, `Year 1/Sessions/FirstSemester/Week1/Text.py` |
| HTML `.html` | 2 | `Year 1/Sessions/SecondSemester/Web/ajax.html`, `Year0 /Extra courses/JS Frontend/index.html` |
| JavaScript `.js` | 1 | `Year 1/Sessions/SecondSemester/Web/script.js` |
| TypeScript `.ts` | 1 | `Year2/SecondSemester/WebAppDev/grade.ts` |
| JSON `.json` | 4 | Repository metadata: `package.json`, `package-lock.json`, `.vscode/settings.json`, `.vscode/tasks.json` |
| **Total** | **544** | |

The preliminary figures (118 Markdown, 330 PNG, 603 entries, about 53 MB) are **confirmed**.

All 55 text source and metadata files are US-ASCII or UTF-8.

### 2.1 Empty files (0 bytes)

| Path |
|---|
| `Uni/Year 1/Sessions/idk.md` |
| `Uni/Year0 /Sessions/Computing/FirstSemester/Session 23-01-24.md` |
| `Uni/Year0 /Sessions/Computing/SecondSemester/5th-week/PB/PB12-03-24.md` |
| `Uni/Year2/SecondSemester/Reasearch Methods/05-03-26.md` |

### 2.2 Duplicate content

| Content | Files | Assessment |
|---|---|---|
| Empty (SHA-256 `e3b0c442…`) | the 4 empty `.md` files above | They are only identical because they are empty. Each is a different note (different module and date) |
| PNG `259234af…` | `Year 1/Extra/image-20.png`, `Year 1/Extra/image-21.png` | Identical bytes; each is referenced separately |
| Near-duplicate notes | `10th-week/IPR08-05-24.md` and `10th-week/IPR08-05-24_.md` | Same text. The `_` copy differs only in whitespace (trailing spaces, and a space before `)` in image references). They share the same four images |

No two non-empty Markdown files have byte-identical content.

### 2.3 Duplicate filenames

These names occur in several folders. They are distinct files and must be resolved by full path:

- **PNG:** `image.png` (30 folders), `image-1.png` (28), `image-2.png` (26), `image-3.png` (23), and so on, up to `image-39.png` (2). There are 41 repeated PNG names in total.
- **Markdown:** `UX.md` (3), `14-10-2025.md` (2), `13-11-25.md` (2), `16-10-25.md` (2), `21-02-26.md` (2). In each case the copies are in different modules.
- **Code:** `exercise.c` (10), `exercise2.c` (7), `exercise3.c` (2), `lesson.c` (2), plus their compiled binaries.

## 3. Folder hierarchy

```
Uni-test/
├── readme.md, image.png, image-1.png, image-2.png   ← old repo readme (Year 0 links)
├── package.json, package-lock.json, .vscode/        ← repository metadata
└── Uni/
    ├── Books Notes/                                  ← independent reading
    ├── Year0 /   (Foundation Year, 2023/24)
    │   ├── InductionsYear0/                          ← 4 induction sessions (Oct 2023)
    │   ├── Extra courses/  Fullstack web dev · Intro to Cybersecurity · JS Frontend
    │   └── Sessions/Computing/
    │       ├── FirstSemester/                        ← 30 dated "Session"/"Review" notes + image folder
    │       │   └── Computing Maths/                  ← 5 maths notes
    │       ├── SecondSemester/
    │       │   ├── 1st-week … 12th-week/             ← DM / PB / IDRP notes + C exercises
    │       │   └── PB-Assesment/                     ← 18 C assessment tasks + binaries
    │       └── resources/von.png
    ├── Year 1/   (2024/25)
    │   ├── Extra/  Cisco course, network/, Google, python + images
    │   └── Sessions/
    │       ├── FirstSemester/ Week1–4, week6, week8   ← NET / UX / PSTP notes
    │       ├── SecondSemester/ Data Analysis · Database · Web
    │       └── idk.md (empty)
    └── Year2/    (2025/26)
        ├── FirstSemester/ Advanced Database Systems · Analytics and Business Intelligence · Object Oriented Design and Dev
        ├── SecondSemester/ HCI · Reasearch Methods · WebAppDev
        └── Side Courses/Kotlin
```

### 3.1 How academic years map to calendar years

The filename dates are evidence for which calendar year each folder covers:

| Source folder | Dated notes span | Proposed `academic_year` |
|---|---|---|
| `Year0 ` (trailing space) | 2023-10-03 → 2024-05-15 | `2023/24` (Foundation Year) |
| `Year 1` | 2024-10-14 → 2025-04-02 | `2024/25` |
| `Year2` | 2025-10-14 → 2026-03-05 | `2025/26` |

The `2025/26` format matches the hint in the UniNotes module form. The three different spellings of the source folders (`Year0 `, `Year 1`, `Year2`) all map to these values. The source is not changed.

### 3.2 Modules found in the folders

- **Foundation Year, semester 1:** the `Session DD-MM-YY.md` files mix two subjects. Tuesday and Saturday notes are headed "Computing" or "Computing Foundations". Wednesday notes are headed "Group Project" or "Group Technology". Computing Maths has its own folder.
- **Foundation Year, semester 2:** subjects are identified by filename prefix:
  - `DM` / `MD` = Digital Media (Technologies).
  - `PB` = Problem Solving. The heading of the first PB note is "Problem Solving - first session" and the module is taught in C. The working name "Programming Basics" from the brief does **not** appear in the source.
  - `IDRP` / `IPR` / `IRP` / `IDPR` / `IRPD` / `IR` = Individual Degree Related Project.
  - Weeks run from `1st-week` to `12th-week`.
- **Year 1, semester 1:** subjects are identified by filename prefix:
  - `NET` = Networking.
  - `UX` = User Experience.
  - `PSTP` = Problem Solving Through Programming. This module is not in the brief's list; it is a single note plus `Week2/Python.md`.
  - Week folders are `Week1`–`Week4`, `week6` and `week8`.
- **Year 1, semester 2:** one folder per module: Data Analysis, Database, Web. The Web notes are headed "Web Tech".
- **Year 2:** one folder per module. The source spells two names unusually: "Reasearch Methods" and "Object Oriented Design and Dev".
- **Independent study:**
  - Year 0 extra courses: Fullstack, Cybersecurity, JS Frontend.
  - Year 1 extras: the Cisco network course (3 notes), Google Cloud, a Python course.
  - Year 2 side course: Kotlin.
  - Book notes.

## 4. Markdown content

| Feature | Found | UniNotes support |
|---|---|---|
| Headings | In 110 of 118 files. 9 files have no H1 | Supported |
| Fenced code blocks | *Correction: UniNotes' parser finds 94 fenced blocks plus 18 indented code blocks (112 in total); the line-based count here said 96.* 96 fence lines: `tsx` 36, `jsx` 29, `c` 8, `python` 6, `bash` 4, `js` 3, `kotlin` 3, `html` 2, `markdown` 2, `json` 1, no language 2. None left unclosed | Supported (CodeBlock with a language class) |
| Tables | 1 | Supported (GFM) |
| Task lists | 0 | — |
| Maths (`$…$` / `$$…$$`) | 0 | Supported (KaTeX) but unused |
| Mermaid | 0 | Supported but unused |
| Embedded images | 334 written references to local PNGs. **332 are valid images**; 2 are broken markup (§5.1) | Must be rewritten to `/api/attachments/<id>/content`. The renderer shows **only** attachment URLs and `data:` images; local relative paths show as "Image unavailable" |
| Internal `.md` → `.md` links | **0** | Nothing to rewrite |
| Wiki links `[[…]]` | 0 | — |
| External links | 27: Dropbox 12, developer.android.com 3, and one each to other sites | Preserved; they open in a new tab |
| Raw HTML outside code | 1: `Maths-General-Notes.md` line 1 `<h1 style='color:red'> Here I store general Maths notes</h1>` | **Not rendered**: the renderer uses `skipHtml`, so this note's only heading would disappear |
| Unusual characters | Typographic quotes, `—`, 3 emoji. `react-typescript.md` contains 7 leftover chat-tool citation markers (`cite` + `turn0search…` using private-use characters U+E200–E202) | Shown as literal text. The markers look like junk |
| Largest note | `react-typescript.md`, 13,130 bytes | Well under the 1,000,000-character limit |

### 4.1 Citation leftovers in `react-typescript.md` (kept verbatim; correction proposed only)

There are 7 markers, each placed directly after the sentence it cites. Each marker is the word `cite` and one or more `turn0searchN` ids, separated by the private-use characters U+E200/U+E202 and closed by U+E201. They render as junk text such as `citeturn0search1turn0search6`. These are leftovers from a chat tool's source citations.

| Line | Marker (private-use characters shown as ‹ ›) | Follows the sentence ending… |
|---:|---|---|
| 80 | `‹cite›turn0search1‹›turn0search6‹›turn0search18‹end›` | "…recommend using a build tool such as Vite for new projects." |
| 109 | `‹cite›turn0search14‹›turn0search17‹›turn0search20‹›turn0search23‹end›` | "…these “everyday types” and object/function typing patterns." |
| 191 | `‹cite›turn0search15‹›turn0search17‹›turn0search2‹end›` | "…expected prop shape with object types or interfaces." |
| 318 | `‹cite›turn0search0‹end›` | "…`null`, empty arrays, or more complex shapes are involved." |
| 433 | `‹cite›turn0search15‹›turn0search20‹end›` | "…TypeScript describes the function signature." |
| 575 | `‹cite›turn0search0‹›turn0search1‹end›` | "…`Link` is the standard pattern in current docs." |
| 615 | `‹cite›turn0search11‹›turn0search0‹end›` | "…rather than forcing complex types up front." |

**Recommended correction (not applied):** delete each marker, together with the single space before it, using the pattern `\s?\uE200cite(\uE202turn\d+search\d+)+\uE201`. The surrounding sentences stay intact. Only the junk is removed; the search ids point to nothing, so no information is lost. If you approve, it would be applied to the imported copy only and recorded as a transformation.

## 5. Images

- **330 PNGs**, all of which are used by at least one note **once the root-relative path below is resolved**. For `10th-week/image-9.png`, this also needs the markup repair in §5.1.
- **333 references are relative**, resolved against the Markdown file's own folder. They all resolve to existing files. Every `image.png` and `image-N.png` resolves inside the note's own folder, so the repeated names do not collide when resolved by full path.
- **1 reference is root-relative**: `Session 04-11-23.md` → `/Uni/Sessions/Computing/resources/von.png`.
  - That path does not exist in the archive. The file **does exist** at `Uni/Year0 /Sessions/Computing/resources/von.png`: the old repository had no `Year0 /` level.
  - It is the only image no note references by its current path, so the match is unambiguous.
  - **Recommendation:** map it to that file and record the remap in the manifest.
- **Images shared by two notes:** `10th-week/image-7.png`, `image-8.png`, `image-9.png` and `image-10.png` are used by both `IPR08-05-24.md` and `IPR08-05-24_.md`.

### 5.1 Correction: two image references are broken markup (found by the dry run)

Revision 2 counted 334 image references. The analysis script's pattern allowed line breaks inside `![…]`. In both `10th-week/IPR08-05-24.md` and `IPR08-05-24_.md`, lines 5–7 read:

```
![
    
](image-9.png)
```

(In the `_` copy the middle line has 2 spaces instead of 4.)

In CommonMark, a whitespace-only line ends the paragraph. So this is **not** an image in UniNotes, nor in the VS Code preview: it renders as the literal text `![` and `](image-9.png)`. I confirmed this with the frontend's own parser (`remark-parse` + `remark-gfm`). Run over all 118 notes, that parser finds **332** images, and they match the importer's references note for note.

Without a repair, `image-9.png` is referenced by no note, and the importer blocks on it as unaccounted for. **Repair (approved 2026-10-20 and applied):** in the imported copies only, replace those three lines with `![](image-9.png)`. The alt text was only whitespace, so the empty alt is faithful. With the repair there are 334 references and all 330 images are used. The mapping carries it as a `replace-line` transformation with `pendingApproval: true`, and the importer refuses a real run until that flag is removed.
- **Unused images:** none after the remap above.
- **Missing images:** none after the remap above.
- **Size limits:**
  - Largest file: 1.96 MB. The UniNotes limit is 10 MB.
  - One image exceeds the 4096 px maximum dimension: `Year0 /Sessions/Computing/FirstSemester/image.png`, 5405×3901 RGB, used by `Session 16-01-24.md`. The existing attachment pipeline will downscale it to **4096×2956**, and the manifest records both sizes. The untouched original stays in the ZIP (see the mapping document, §6).
  - All other images keep their dimensions. PNGs are re-encoded losslessly (sharp, compression level 9, metadata stripped).

## 6. Dates in filenames

- 85 notes contain a date in their filename:
  - `DD-MM-YY` or `DD-MM-YYYY`, e.g. `Session 17-10-23.md`, `05-03-2025.md`.
  - `DDMMYY`, e.g. `NET141024.md`, `IDPR130324.md`.
- Every one parses as a real calendar date, read UK-style (day first). 84 fall inside their folder's academic year, and the weekdays follow a consistent timetable:
  - Foundation semester 1: Tuesday, Wednesday and Saturday.
  - Foundation semester 2: Tuesday and Wednesday.
- **`Maths 31-10-32.md` → 2032-10-31**, a Sunday, is outside any academic year. The filename is almost certainly a typo for `31-10-23`: that is a Tuesday, the same weekday as the other maths notes (17-10, 24-10), and `Session 31-10-23.md` exists. **You approved correcting it to 2023-10-31.** The original filename and the correction are recorded in the manifest.
- **33 notes have no date in their filename.** Two of these, `Maths-General-Notes.md` and `readme.md`, have no H1 either. The mapping document lists them all.

> **Decision (option A):** the 33 undated notes will have `lecture_date = NULL`. This needs a schema migration, set out in `LEGACY_NOTES_MAPPING.md` §4. No other dates are inferred. The ZIP entry timestamps were checked: all 603 are 2026-03-21 04:27:16, the time the archive was created, so they say nothing about when lectures happened.

## 7. Programming files and other resources

| Group | Files | Recommendation |
|---|---|---|
| C exercises (Foundation semester 2, Problem Solving) | 45 `.c` in 13 folders: one folder per week from `1st-week` to `12th-week` (27 files) plus `PB-Assesment` (18) | Keep byte-for-byte as download-only attachments (see the mapping document, §5). Never compile or run |
| Compiled executables | 41 ELF binaries | **Do not import.** These are build outputs of the `.c` files. `Assesment1` has no source and is recorded in the manifest as excluded |
| Small web/script files | `test.py`, `Text.py`, `ajax.html`, `script.js`, `index.html`, `grade.ts` (4 KB in total) | Keep byte-for-byte as download-only attachments |
| Repository metadata | `package.json`, `package-lock.json`, `.vscode/settings.json`, `.vscode/tasks.json` | Exclude; record in the manifest as `excluded: repository-metadata` |

The UniNotes attachment store currently accepts only PNG, JPEG, WebP and PDF (`attachments.service.ts`). The mapping document, §5, proposes a small, download-only "source text" attachment type that needs no schema change.

## 8. UniNotes database and account (confirmed)

**Correction.** Revision 1 of this document wrongly reported that the database was missing. The files were there all along. My check had piped `ls -la data/db data/attachments` through `| head`; the attachments listing printed first, and `head` cut the output off just before the database files. A filesystem-wide `find … | head` was truncated the same way.

Read-only checks (revision 2):

| Check | Result |
|---|---|
| `pwd` / repository root | `/workspaces/UniNotes` / `/workspaces/UniNotes` |
| Database files | `Backend/data/db/uninotes.db` (196,608 B, last written 2026-10-18 18:59 UTC), `uninotes.db-wal` (0 B), `uninotes.db-shm` (32 KB) |
| Effective path | `config.ts`: `path.resolve(DATA_DIR)/db/uninotes.db`, with `DATA_DIR=./data` from `Backend/.env` and no `DATABASE_PATH`. The path is resolved against the process's working directory, so it must be started from `Backend/` (as `npm run dev` does). There is no `/workspaces/UniNotes/data` |
| Running backend / open handles | No UniNotes backend process is running, and no process holds the database files open (checked with `lsof`, `fuser` and `/proc/*/fd`) |
| Other containers or workspaces | None; no Docker containers or volumes |
| Journal mode | **WAL**: header bytes 18–19 = `02 02`, and `client.ts` sets `journal_mode = WAL`. The WAL file is empty, so every committed transaction is in the main file |
| How it was read | Python `sqlite3` with `mode=ro&immutable=1`, which performs no writes at all, not even to `-shm`. This is safe only because the WAL is empty and nothing else has the file open |
| `integrity_check` / `foreign_key_check` | ok / no violations |
| Migrations applied | `0000_init`, `0001_search_fts` |
| Account | Username **`switchback`**; display name **`Wesley`** (capital W); ID **`751aab78-49e0-440f-a517-f0ea1db5a4d9`**; the only user |
| Existing modules | 1: *Data Science* (`2026/27`) |
| Existing notes | 1: *Test note* (soft-deleted). Its image attachment is the file in `Backend/data/attachments/`, which is therefore **not** orphaned, as revision 1 wrongly said |
| `uninotes.db` SHA-256 at the time of this check | `76978608bace61793794162c4f278cf52b2c54bca4ec24a9a7552453ed708e1c` |

No password hashes, session data, MFA secrets or recovery codes were read or displayed.

## 9. Recommended handling (summary, revision 3)

| Issue | Handling |
|---|---|
| `von.png` root-relative path | Resolve to `Uni/Year0 /Sessions/Computing/resources/von.png`, using the unique-match rule in the mapping document, §6; record the remap |
| Repeated `image*.png` names | Always resolve by full source path. Create one attachment per unique source image; a note that reuses an image references the same attachment |
| Identical PNG content (`image-20`/`image-21`) | Import both. They are separate references |
| Empty notes (4) | Import each as a separate empty note, tagged `legacy-empty`, and marked `empty` in the manifest (your decision) |
| `IPR08-05-24_.md` near-duplicate | Import as a separate note, tagged `legacy-near-duplicate` (no merge) |
| Raw HTML heading in `Maths-General-Notes.md` | Convert to `# Here I store general Maths notes` (a recorded transformation; awaiting your confirmation) |
| Citation markers in `react-typescript.md` | Kept verbatim (your decision). A correction is proposed in §4.1 |
| `Maths 31-10-32.md` | Dated 2023-10-31 (approved); the original filename is recorded |
| 33 undated notes | `lecture_date = NULL`, after a schema migration (mapping document, §4) |
| Source code (51 files) | Download-only "source text" attachments, kept byte-for-byte (mapping document, §5) |
| Executables (41) and repository metadata (4) | Excluded from the app; each file listed in the manifest with its reason |
| Image larger than 4096 px | Downscaled to 4096×2956 by the existing pipeline; recorded. The original stays in the ZIP |
| Broken `image-9.png` markup in the two `IPR08-05-24` notes | Repaired to `![](image-9.png)` in the imported copies (approved and applied, §5.1) |
