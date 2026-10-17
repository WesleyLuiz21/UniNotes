import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNote, createTestEnv, loggedInClient, type TestEnv } from './helpers.js';
import { PNG_1x1 } from './fixtures.js';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/db/client.js';

let env: TestEnv;
beforeEach(() => {
  env = createTestEnv();
});
afterEach(() => env.cleanup());

const run = (script: string, args: string[]) =>
  execFileSync(path.resolve('node_modules/.bin/tsx'), [path.resolve('scripts', script), ...args], {
    env: {
      ...process.env,
      DATA_DIR: env.dir,
      APP_SECRET_KEY: 'test-secret-key-that-is-long-enough-123456',
      APP_ORIGIN: 'http://uninotes.test',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

describe('backup and restore', () => {
  it('creates a verified consistent backup and restores it', async () => {
    const c = await loggedInClient(env);
    const n = await createNote(c, { title: 'Before backup', markdownContent: 'important' });
    const img = (await c.upload('/api/attachments', { noteId: n.id }, { buffer: PNG_1x1, name: 'a.png' }))
      .body.data;

    const out = run('backup.ts', []);
    const dir = out.trim().split('\n').at(-1)!;
    expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    expect(manifest.database.notes).toBe(1);
    expect(manifest.attachments.count).toBe(1);
    // Sessions are not included in backups.
    const snap = new Database(path.join(dir, 'uninotes.db'), { readonly: true });
    expect((snap.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n).toBe(0);
    snap.close();
    expect(run('backup.ts', ['--verify', dir])).toContain('Backup OK');

    // Change data after the backup, then restore.
    await createNote(c, { title: 'After backup' });
    await c.delete(`/api/attachments/${img.id}`);
    env.ctx.db.$client.close();

    const restoreOut = run('restore.ts', [dir, '--yes']);
    expect(restoreOut).toContain('Restored backup');
    const db = openDatabase(env.ctx.config.paths.database);
    const titles = db.$client.prepare('SELECT title FROM notes').all() as { title: string }[];
    expect(titles.map((t) => t.title)).toEqual(['Before backup']);
    const fts = db.$client.prepare("SELECT note_id FROM notes_fts WHERE notes_fts MATCH 'important'").all();
    expect(fts).toHaveLength(1);
    db.$client.close();
    expect(fs.readdirSync(env.ctx.config.paths.attachments)).toHaveLength(1);
    // Restore preserved the pre-restore state.
    expect(fs.readdirSync(env.ctx.config.paths.backups).some((d) => d.startsWith('pre-restore-'))).toBe(true);
    // Re-open so cleanup can close it.
    env.ctx.db = openDatabase(env.ctx.config.paths.database);
  });

  it('refuses to restore a tampered backup', async () => {
    const c = await loggedInClient(env);
    await createNote(c);
    const dir = run('backup.ts', []).trim().split('\n').at(-1)!;
    fs.appendFileSync(path.join(dir, 'uninotes.db'), 'garbage');
    expect(() => run('restore.ts', [dir, '--yes'])).toThrow(/checksum mismatch/);
  });
});
