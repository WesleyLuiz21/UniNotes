/**
 * Consistent local backup: SQLite online-backup API snapshot (safe while the app is running),
 * attachment copy, checksummed manifest and verification. Older local backups are pruned.
 *
 *   node dist/scripts/backup.js                 create a backup in $BACKUP_DIR/local/<timestamp>
 *   node dist/scripts/backup.js --verify <dir>  verify an existing backup directory
 *
 * Prints the backup directory path on the last line of stdout. Exits non-zero on any failure.
 * Offsite (encrypted, Restic) copies are handled by scripts/backup.sh on the host.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { cliContext, arg, fail } from './_cli.js';
import { sha256File, verifyBackup, type BackupManifest } from './_backup-lib.js';

const verifyDir = arg('verify');
if (verifyDir !== undefined) {
  const { problems, manifest } = await verifyBackup(path.resolve(verifyDir));
  if (problems.length) fail(`Backup verification failed:\n - ${problems.join('\n - ')}`);
  console.log(
    `Backup OK: ${manifest!.database.notes} notes, ${manifest!.attachments.count} attachments (${manifest!.createdAt})`,
  );
  process.exit(0);
}

const { config, db } = cliContext();
const keep = Number(process.env.LOCAL_BACKUP_KEEP ?? 7);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const root = path.join(config.paths.backups, 'local');
const dir = path.join(root, stamp);
const tmpDir = `${dir}.partial`;
fs.mkdirSync(path.join(tmpDir, 'attachments'), { recursive: true, mode: 0o700 });

try {
  // 1. Database snapshot via SQLite's online backup API (consistent even with concurrent writes).
  const dbFile = path.join(tmpDir, 'uninotes.db');
  await db.$client.backup(dbFile);
  db.$client.close();

  const snap = new Database(dbFile);
  snap.pragma('journal_mode = DELETE'); // self-contained single file
  const notes = (snap.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n;
  const users = (snap.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  const migrations = (snap.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as { n: number })
    .n;
  // Sessions are short-lived credentials (hashed) and are not needed to restore; drop them.
  snap.exec('DELETE FROM sessions; VACUUM;');
  const keys = (snap.prepare('SELECT storage_key FROM attachments').all() as { storage_key: string }[]).map(
    (r) => r.storage_key,
  );
  snap.close();

  // 2. Attachments referenced by the snapshot. Files are immutable once written, so copying after
  //    the DB snapshot yields a consistent pair.
  let bytes = 0;
  for (const key of keys) {
    const src = path.join(config.paths.attachments, path.basename(key));
    if (!fs.existsSync(src)) continue; // reported by verification below
    fs.copyFileSync(src, path.join(tmpDir, 'attachments', path.basename(key)));
    bytes += fs.statSync(src).size;
  }

  const manifest: BackupManifest = {
    format: 'uninotes-backup',
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    database: {
      file: 'uninotes.db',
      sha256: await sha256File(dbFile),
      bytes: fs.statSync(dbFile).size,
      migrations,
      notes,
      users,
    },
    attachments: { dir: 'attachments', count: keys.length, bytes },
  };
  fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // 3. Verify before declaring success.
  const { problems } = await verifyBackup(tmpDir);
  if (problems.length) throw new Error(`Verification failed:\n - ${problems.join('\n - ')}`);
  fs.renameSync(tmpDir, dir);

  // 4. Prune old local backups (offsite retention is handled by restic).
  const existing = fs
    .readdirSync(root)
    .filter((d) => !d.endsWith('.partial') && fs.existsSync(path.join(root, d, 'manifest.json')))
    .sort();
  for (const old of existing.slice(0, Math.max(0, existing.length - keep))) {
    fs.rmSync(path.join(root, old), { recursive: true, force: true });
  }
  console.log(`Backup complete: ${notes} notes, ${keys.length} attachments`);
  console.log(dir);
} catch (err) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fail(err instanceof Error ? err.message : String(err));
}
