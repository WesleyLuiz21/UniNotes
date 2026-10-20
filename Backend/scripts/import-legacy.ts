/**
 * Import a legacy Markdown notes archive for an existing user (operator CLI; no HTTP endpoint).
 *
 *   npm run import:legacy -- --zip <archive.zip> --mapping <mapping.json> --username <name> --dry-run \
 *     --manifest <out.json> [--report <out.md>]
 *   npm run import:legacy -- ... --confirm          (real import; take a backup first: npm run backup)
 *
 * --dry-run opens the database read-only and writes nothing except the manifest/report files.
 * The archive is never modified; its SHA-256 is checked against the mapping before and after.
 * Exits non-zero if the plan has blocking problems or the import fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { loadConfig } from '../src/config.js';
import { createContext } from '../src/context.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { migrationStatus } from '../src/db/migrations.js';
import * as schema from '../src/db/schema.js';
import { createLogger } from '../src/logger.js';
import {
  buildManifest,
  executeImport,
  LegacyMappingSchema,
  planImport,
  readArchive,
  resolveUser,
  sha256FileSync,
  type ImportManifest,
} from '../src/services/legacy-import.service.js';
import { arg, fail, flag } from './_cli.js';

const zipPath = path.resolve(arg('zip') || fail('--zip <archive.zip> is required'));
const mappingPath = path.resolve(arg('mapping') || fail('--mapping <mapping.json> is required'));
const username = arg('username') || fail('--username is required');
const manifestPath = path.resolve(arg('manifest') || fail('--manifest <out.json> is required'));
const reportPath = arg('report') ? path.resolve(arg('report')!) : null;
const dryRun = flag('dry-run');
if (!dryRun && !flag('confirm')) fail('Pass --dry-run, or --confirm to perform the import');

const mappingRaw = fs.readFileSync(mappingPath);
const parsed = LegacyMappingSchema.safeParse(JSON.parse(mappingRaw.toString('utf8')));
if (!parsed.success) fail(`Invalid mapping file:\n${parsed.error.message}`);
const mapping = parsed.data;
if (username !== mapping.targetUsername)
  fail(`--username ${username} does not match the mapping's targetUsername (${mapping.targetUsername})`);

const sha256Before = sha256FileSync(zipPath);
if (sha256Before !== mapping.archive.sha256)
  fail(`Archive checksum ${sha256Before} does not match the approved mapping (${mapping.archive.sha256})`);

const config = loadConfig();
// Dry run: a read-only connection, so SQLite itself refuses any write.
const db: DB = dryRun
  ? (drizzle(new Database(config.paths.database, { readonly: true, fileMustExist: true }), { schema }) as DB)
  : openDatabase(config.paths.database);
const ctx = createContext(config, db, createLogger('warn'));

const status = migrationStatus(db);
if (status.pending.length)
  fail(`Database has pending migrations (${status.pending.join(', ')}); run db:migrate first`);

const row = resolveUser(ctx, username);
if (!row) fail(`User "${username}" does not exist. No user will be created.`);
const user = { id: row.id, username: row.username, displayName: row.display_name };

console.log(`Mode:      ${dryRun ? 'DRY RUN (read-only)' : 'IMPORT'}`);
console.log(`Database:  ${config.paths.database}`);
console.log(`Archive:   ${zipPath} (sha256 ${sha256Before})`);
console.log(`Target:    ${user.username} / ${user.displayName} / ${user.id}`);

const archive = await readArchive(zipPath, mapping.archive.archiveRoot);
const plan = await planImport(ctx, mapping, archive, user);

if (!dryRun && plan.pendingApprovals.length) {
  fail(
    `Transformations pending approval (set pendingApproval to false once approved):\n - ${plan.pendingApprovals.join('\n - ')}`,
  );
}
let failed = null;
if (!dryRun && plan.problems.length === 0) failed = executeImport(ctx, mapping, plan).failed;

const manifest = buildManifest(plan, mapping, {
  mode: dryRun ? 'dry-run' : 'import',
  zipPath,
  sha256Before,
  sha256After: sha256FileSync(zipPath),
  mappingPath,
  mappingSha256: sha256FileSync(mappingPath),
  entries: archive.entries,
  directories: archive.directories,
  failed,
});
db.$client.close();

fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const report = renderReport(manifest);
if (reportPath) fs.writeFileSync(reportPath, report);
console.log(`\n${report}`);
console.log(`Manifest:  ${manifestPath}${reportPath ? `\nReport:    ${reportPath}` : ''}`);

if (!manifest.archive.unchanged) fail('The archive changed during the run');
if (plan.problems.length) fail(`${plan.problems.length} blocking problem(s); nothing was imported`);
if (failed) fail(`Import stopped at ${failed.what}: ${failed.error}`);

function renderReport(m: ImportManifest): string {
  const s = m.summary;
  const counts = (o: Record<string, number>) =>
    Object.entries(o)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
  const lines = [
    `## Legacy import ${m.mode === 'dry-run' ? 'dry run' : 'result'} (${m.generatedAt})`,
    '',
    `- Target account: \`${m.target.username}\` (${m.target.displayName}), user ID \`${m.target.userId}\``,
    `- Archive: \`${path.basename(m.archive.path)}\`, SHA-256 matches the approved mapping; unchanged after run: ${m.archive.unchanged ? 'yes' : 'NO'}`,
    `- Archive contents: ${m.archive.entries} entries (${m.archive.directories} folders, ${m.archive.files} files)`,
    `- Modules: create ${s.modules.create}, reuse ${s.modules.reuse}`,
    `- Original notes: ${counts(s.originalNotes)}`,
    `- Generated source-file notes: ${counts(s.generatedNotes)}`,
    `- New notes in total: ${s.totalNewNotes}; new notes without a lecture date: ${s.newNotesWithoutLectureDate}`,
    `- Original notes without a lecture date: ${s.originalNotesWithoutLectureDate}; corrected dates: ${s.correctedLectureDates}`,
    `- Empty notes: ${s.emptyNotes}; notes with transformations: ${s.notesWithTransformations}`,
    `- Images: ${counts(s.images)} (${s.imageReferences} references; ${s.resizedImages} downscaled)`,
    `- Source-code files: ${counts(s.sourceFiles)}`,
    `- Excluded: ${counts(s.excluded)}`,
    `- Blocking problems: ${s.problems}; warnings: ${s.warnings}`,
    '',
    '### Modules',
    '',
    '| Module | Academic year | Action |',
    '|---|---|---|',
    ...m.modules.map((x) => `| ${x.name} | ${x.academicYear ?? '—'} | ${x.action} |`),
    '',
    '### Date corrections',
    '',
    ...m.notes
      .filter((n) => n.dateCorrection)
      .map(
        (n) =>
          `- \`${n.source}\`: filename date ${n.dateCorrection!.filenameDate} (${n.dateCorrection!.parsedAs}) → ${n.lectureDate}`,
      ),
    '',
    '### Markdown transformations',
    '',
    ...m.notes.flatMap((n) =>
      n.transformations.map(
        (t) =>
          `- \`${n.source}\`: ${t.type}${t.type === 'replace-line' ? ` (line ${String(t.line)})` : ` (${String(t.count)} removed, lines ${(t.lines as number[]).join(', ')})`}`,
      ),
    ),
    ...m.notes.flatMap((n) =>
      n.images
        .filter((i) => i.remappedFrom)
        .map((i) => `- \`${n.source}\`: image ${i.remappedFrom} → ${i.resolvedSource}`),
    ),
    '',
    '### Resized images',
    '',
    ...m.images
      .filter((i) => i.storedSize.width !== i.originalSize.width)
      .map(
        (i) =>
          `- \`${i.source}\`: ${i.originalSize.width}×${i.originalSize.height} → ${i.storedSize.width}×${i.storedSize.height}`,
      ),
    '',
    '### Warnings',
    '',
    ...(m.warnings.length || m.notes.some((n) => n.warnings.length)
      ? [
          ...m.warnings.map((w) => `- ${w}`),
          ...m.notes.flatMap((n) => n.warnings.map((w) => `- \`${n.source}\`: ${w}`)),
        ]
      : ['- none']),
    '',
    '### Transformations pending your approval',
    '',
    ...(m.pendingApprovals.length ? m.pendingApprovals.map((p) => `- ${p}`) : ['- none']),
    '',
    '### Blocking problems',
    '',
    ...(m.problems.length ? m.problems.map((p) => `- ${p}`) : ['- none']),
    ...(m.failure ? ['', `**Import stopped** at ${m.failure.what}: ${m.failure.error}`] : []),
    '',
  ];
  return lines.join('\n');
}
