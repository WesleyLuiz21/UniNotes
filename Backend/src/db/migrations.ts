import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
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

export function runMigrations(db: DB) {
  migrate(db, { migrationsFolder: migrationsFolder() });
}
