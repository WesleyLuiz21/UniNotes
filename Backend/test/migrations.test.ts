import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../src/db/client.js';
import { migrationsFolder, migrationStatus, runMigrations } from '../src/db/migrations.js';
import { attachments, modules } from '../src/db/schema.js';
import { newId } from '../src/lib/crypto.js';
import { createNote } from '../src/services/notes.service.js';
import { createUser } from '../src/services/users.service.js';

const dirs: string[] = [];
const tmpDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'uninotes-mig-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A copy of the migrations folder containing only the first `count` migrations (plus optional extras). */
function partialMigrations(count: number, extra: { tag: string; sql: string }[] = []) {
  const src = migrationsFolder();
  const dst = path.join(tmpDir(), 'drizzle');
  fs.mkdirSync(path.join(dst, 'meta'), { recursive: true });
  const journal = JSON.parse(fs.readFileSync(path.join(src, 'meta', '_journal.json'), 'utf8')) as {
    entries: { idx: number; when: number; tag: string; version: string; breakpoints: boolean }[];
  };
  const entries = journal.entries.slice(0, count);
  for (const e of entries) fs.copyFileSync(path.join(src, `${e.tag}.sql`), path.join(dst, `${e.tag}.sql`));
  let when = entries.at(-1)!.when;
  for (const x of extra) {
    when += 1000;
    fs.writeFileSync(path.join(dst, `${x.tag}.sql`), x.sql);
    entries.push({ idx: entries.length, when, tag: x.tag, version: '6', breakpoints: true });
  }
  fs.writeFileSync(path.join(dst, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
  return dst;
}

/** Every row of every table (FTS shadow tables excluded), for before/after comparison. */
function dump(db: DB) {
  const tables = [
    'users',
    'modules',
    'notes',
    'note_versions',
    'tags',
    'note_tags',
    'attachments',
    'notes_fts',
  ];
  return Object.fromEntries(
    tables.map((t) => [t, db.$client.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all()]),
  );
}

/** A database at the schema before 0002 (lecture_date NOT NULL), seeded through the real services. */
async function seededPre0002() {
  const db = openDatabase(path.join(tmpDir(), 'x.db'));
  runMigrations(db, partialMigrations(2));
  const user = await createUser(db, {
    username: 'switchback',
    displayName: 'Wesley',
    password: 'pw-long-enough-123',
  });
  const moduleId = newId();
  db.insert(modules)
    .values({
      id: moduleId,
      userId: user.id,
      name: 'Data Science',
      academicYear: '2026/27',
      color: '#3B82F6',
      createdAt: '2026-10-18T00:00:00.000Z',
      updatedAt: '2026-10-18T00:00:00.000Z',
    })
    .run();
  const a = createNote(db, user.id, {
    title: 'Dated note',
    markdownContent: 'searchable content',
    moduleId,
    lectureDate: '2026-10-18',
    tags: ['exam', 'week-1'],
    isFavourite: true,
    versionReason: 'import',
  });
  const b = createNote(db, user.id, {
    title: 'Second',
    markdownContent: 'more',
    moduleId: null,
    lectureDate: '2025-01-02',
    tags: [],
    isFavourite: false,
  });
  db.$client.prepare('UPDATE notes SET deleted_at = ? WHERE id = ?').run('2026-10-19T00:00:00.000Z', b.id);
  db.insert(attachments)
    .values({
      id: newId(),
      userId: user.id,
      noteId: a.id,
      kind: 'image',
      mimeType: 'image/png',
      sizeBytes: 3,
      originalName: 'image.png',
      storageKey: 'k'.repeat(32),
      sha256: '0'.repeat(64),
      createdAt: '2026-10-18T00:00:00.000Z',
    })
    .run();
  return { db, noteId: a.id };
}

describe('database migrations', () => {
  it('apply cleanly to an empty database and are idempotent', () => {
    const db = openDatabase(path.join(tmpDir(), 'x.db'));
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
  });

  it('0002 makes lecture_date nullable and preserves every existing row', async () => {
    const { db, noteId } = await seededPre0002();
    const before = dump(db);
    expect(before.note_versions).toHaveLength(1);
    expect(before.note_tags).toHaveLength(2);
    expect(before.notes_fts).toHaveLength(2);

    runMigrations(db);

    expect(migrationStatus(db).pending).toEqual([]);
    expect(dump(db)).toEqual(before);
    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.$client.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(db.$client.pragma('foreign_key_check')).toEqual([]);
    const indexes = db.$client
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notes' AND sql IS NOT NULL",
      )
      .all()
      .map((r) => (r as { name: string }).name)
      .sort();
    expect(indexes).toEqual([
      'notes_module_idx',
      'notes_source_hash_idx',
      'notes_user_lecture_idx',
      'notes_user_updated_idx',
    ]);
    // NULL is now accepted, and the foreign keys on the rebuilt table are still enforced.
    db.$client.prepare('UPDATE notes SET lecture_date = NULL WHERE id = ?').run(noteId);
    expect(() =>
      db.$client
        .prepare(
          "INSERT INTO notes (id, user_id, title, created_at, updated_at) VALUES ('x', 'no-such-user', 't', 'a', 'a')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
    // Deleting a note still cascades to its versions and tags (child references point at the new table).
    db.$client.prepare('DELETE FROM notes WHERE id = ?').run(noteId);
    expect(db.$client.prepare('SELECT COUNT(*) AS n FROM note_versions').get()).toEqual({ n: 0 });
    expect(db.$client.prepare('SELECT COUNT(*) AS n FROM note_tags').get()).toEqual({ n: 0 });
    db.$client.close();
  });

  it('rolls back a failing migration and restores foreign key enforcement', async () => {
    const { db } = await seededPre0002();
    const before = dump(db);
    const folder = partialMigrations(3, [
      { tag: '0099_broken', sql: 'CREATE TABLE ok_so_far (x);\nTHIS IS NOT SQL;' },
    ]);
    expect(() => runMigrations(db, folder)).toThrow();
    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.$client.inTransaction).toBe(false);
    // Nothing from the batch was applied: not 0002, not the broken migration.
    expect(migrationStatus(db).applied).toBe(2);
    expect(
      db.$client.prepare("SELECT name FROM sqlite_master WHERE name = 'ok_so_far'").get(),
    ).toBeUndefined();
    expect(dump(db)).toEqual(before);
    db.$client.close();
  });

  it('aborts and rolls back when the migrated data would violate a foreign key', async () => {
    const { db } = await seededPre0002();
    const before = dump(db);
    const folder = partialMigrations(3, [
      { tag: '0099_orphan', sql: "UPDATE note_versions SET note_id = 'missing-note';" },
    ]);
    expect(() => runMigrations(db, folder)).toThrow(/foreign key violation/);
    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(migrationStatus(db).applied).toBe(2);
    expect(dump(db)).toEqual(before);
    db.$client.close();
  });

  it('refuses to run inside an open transaction', () => {
    const db = openDatabase(path.join(tmpDir(), 'x.db'));
    db.$client.exec('BEGIN');
    expect(() => runMigrations(db)).toThrow(/open transaction/);
    db.$client.exec('ROLLBACK');
    db.$client.close();
  });
});
