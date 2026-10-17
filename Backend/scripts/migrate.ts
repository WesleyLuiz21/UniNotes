/**
 * Apply database migrations explicitly.
 *   npm run db:migrate            (development, via tsx)
 *   node dist/scripts/migrate.js  (production container: `docker compose run --rm backend npm run db:migrate:prod`)
 * Options: --status (report only), --no-backup (skip the automatic pre-migration snapshot)
 */
import fs from 'node:fs';
import path from 'node:path';
import { migrationStatus, runMigrations } from '../src/db/migrations.js';
import { cliContext, flag } from './_cli.js';

const { config, db } = cliContext();
const status = migrationStatus(db);
console.log(`Database: ${config.paths.database}`);
console.log(`Applied migrations: ${status.applied}/${status.total}`);

if (flag('status')) {
  console.log(status.pending.length ? `Pending: ${status.pending.join(', ')}` : 'Up to date.');
  process.exit(0);
}
if (status.pending.length === 0) {
  console.log('Nothing to migrate.');
  process.exit(0);
}

const hasData = status.applied > 0;
if (hasData && !flag('no-backup')) {
  const dir = path.join(config.paths.backups, 'pre-migration');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `uninotes-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await db.$client.backup(file);
  console.log(`Pre-migration snapshot: ${file}`);
}

console.log(`Applying: ${status.pending.join(', ')}`);
runMigrations(db);
const check = db.$client.pragma('integrity_check', { simple: true });
if (check !== 'ok') {
  console.error(`Integrity check failed after migration: ${String(check)}`);
  process.exit(1);
}
console.log('Migrations applied successfully.');
db.$client.close();
