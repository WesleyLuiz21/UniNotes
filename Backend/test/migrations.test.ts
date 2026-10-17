import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/client.js';
import { migrationStatus, runMigrations } from '../src/db/migrations.js';

describe('database migrations', () => {
  it('apply cleanly to an empty database and are idempotent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uninotes-mig-'));
    const db = openDatabase(path.join(dir, 'x.db'));
    const before = migrationStatus(db);
    expect(before.applied).toBe(0);
    expect(before.pending.length).toBe(before.total);
    runMigrations(db);
    expect(migrationStatus(db).pending).toEqual([]);
    runMigrations(db);
    const tables = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table')")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of [
      'users',
      'sessions',
      'modules',
      'notes',
      'note_versions',
      'attachments',
      'tags',
      'note_tags',
      'audit_events',
      'notes_fts',
      'recovery_codes',
    ]) {
      expect(tables).toContain(t);
    }
    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.$client.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.$client.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(db.$client.pragma('integrity_check', { simple: true })).toBe('ok');
    db.$client.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
