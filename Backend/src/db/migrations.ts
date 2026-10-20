import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { DB } from './client.js';

/** Locate the drizzle/ folder whether running from src/ (tsx) or dist/ (compiled). */
export function migrationsFolder(): string {
  if (process.env.MIGRATIONS_DIR) return path.resolve(process.env.MIGRATIONS_DIR);
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'drizzle');
    if (fs.existsSync(path.join(candidate, 'meta', '_journal.json'))) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('Could not locate the drizzle migrations folder');
}

export interface MigrationStatus {
  applied: number;
  total: number;
  pending: string[];
}

export function migrationStatus(db: DB): MigrationStatus {
  const folder = migrationsFolder();
  const files = readMigrationFiles({ migrationsFolder: folder });
  const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: { tag: string; when: number }[];
  };
  const sqlite = db.$client;
  const hasTable = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  let lastApplied = 0;
  let applied = 0;
  if (hasTable) {
    const row = sqlite
      .prepare('SELECT COUNT(*) AS n, MAX(created_at) AS last FROM __drizzle_migrations')
      .get() as { n: number; last: number | null };
    applied = row.n;
    lastApplied = Number(row.last ?? 0);
  }
  const pending = journal.entries.filter((e) => e.when > lastApplied).map((e) => e.tag);
  return { applied, total: files.length, pending };
}

/**
 * Apply pending migrations in a single transaction, with the same bookkeeping as drizzle's
 * migrator (`__drizzle_migrations` rows of hash + folder timestamp).
 *
 * Foreign-key enforcement is switched off for the duration of the transaction only. Table
 * rebuilds (the documented way to change a column constraint in SQLite) drop the old table, and
 * with enforcement on that DROP would fire ON DELETE CASCADE / SET NULL actions in child tables.
 * PRAGMA foreign_keys cannot change inside a transaction, so it is set here, around it. Before
 * committing, PRAGMA foreign_key_check must report no violations or everything is rolled back.
 * The previous setting is restored whether the migration succeeds or fails.
 */
export function runMigrations(db: DB, folder = migrationsFolder()) {
  const sqlite = db.$client;
  if (sqlite.inTransaction) throw new Error('Migrations cannot run inside an open transaction');
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  const fkBefore = sqlite.pragma('foreign_keys', { simple: true }) as number;
  sqlite.pragma('foreign_keys = OFF');
  try {
    if (sqlite.pragma('foreign_keys', { simple: true }) !== 0) {
      throw new Error('Could not disable foreign keys for the migration');
    }
    sqlite.transaction(() => {
      sqlite.exec(
        'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
      );
      const last = sqlite
        .prepare('SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1')
        .get() as { created_at: number | string } | undefined;
      const insert = sqlite.prepare(
        'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
      );
      for (const m of migrations) {
        if (last && Number(last.created_at) >= m.folderMillis) continue;
        for (const stmt of m.sql) if (stmt.trim()) sqlite.exec(stmt);
        insert.run(m.hash, m.folderMillis);
      }
      const violations = sqlite.pragma('foreign_key_check') as unknown[];
      if (violations.length > 0) {
        throw new Error(`Migration aborted: ${violations.length} foreign key violation(s)`);
      }
    })();
  } finally {
    sqlite.pragma(`foreign_keys = ${fkBefore ? 'ON' : 'OFF'}`);
  }
}
