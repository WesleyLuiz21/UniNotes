/**
 * Restore a verified backup directory into the live data paths.
 * The backend service MUST be stopped first (scripts/restore.sh does this).
 *
 *   node dist/scripts/restore.js <backupDir> --yes
 *
 * The current database and attachments are first preserved in $BACKUP_DIR/pre-restore-<timestamp>/.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/client.js';
import { migrationStatus } from '../src/db/migrations.js';
import { rebuildSearchIndex } from '../src/services/search-index.js';
import { fail, flag } from './_cli.js';
import { verifyBackup } from './_backup-lib.js';

const source = process.argv[2];
if (!source || source.startsWith('--')) fail('Usage: restore.js <backupDir> --yes');
if (!flag('yes'))
  fail('Refusing to restore without --yes (this replaces the current database and attachments)');

const config = loadConfig();
const dir = path.resolve(source);
const { problems, manifest } = await verifyBackup(dir);
if (problems.length) fail(`Backup verification failed; nothing was changed:\n - ${problems.join('\n - ')}`);

// Preserve the current state so a mistaken restore can itself be undone.
const safety = path.join(
  config.paths.backups,
  `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);
fs.mkdirSync(path.join(safety, 'attachments'), { recursive: true });
if (fs.existsSync(config.paths.database)) {
  const live = new Database(config.paths.database);
  await live.backup(path.join(safety, 'uninotes.db'));
  live.close();
}
fs.mkdirSync(config.paths.attachments, { recursive: true });
for (const f of fs.readdirSync(config.paths.attachments)) {
  fs.copyFileSync(path.join(config.paths.attachments, f), path.join(safety, 'attachments', f));
}
console.log(`Current data preserved in ${safety}`);

// Replace the database (remove WAL/SHM so stale pages are not replayed onto the restored file).
fs.mkdirSync(path.dirname(config.paths.database), { recursive: true });
for (const suffix of ['-wal', '-shm']) fs.rmSync(config.paths.database + suffix, { force: true });
fs.copyFileSync(path.join(dir, manifest!.database.file), config.paths.database);

// Replace attachments.
for (const f of fs.readdirSync(config.paths.attachments))
  fs.rmSync(path.join(config.paths.attachments, f), { force: true });
const attSrc = path.join(dir, manifest!.attachments.dir);
for (const f of fs.readdirSync(attSrc))
  fs.copyFileSync(path.join(attSrc, f), path.join(config.paths.attachments, f));

// Post-restore checks.
const db = openDatabase(config.paths.database);
const integrity = db.$client.pragma('integrity_check', { simple: true });
if (integrity !== 'ok') fail(`Restored database failed integrity check: ${String(integrity)}`);
rebuildSearchIndex(db);
const status = migrationStatus(db);
db.$client.close();

console.log(
  `Restored backup from ${manifest!.createdAt}: ${manifest!.database.notes} notes, ${manifest!.attachments.count} attachments.`,
);
if (status.pending.length) {
  console.log(
    `NOTE: the backup predates ${status.pending.length} migration(s). Run the migrate command before starting the backend.`,
  );
}
