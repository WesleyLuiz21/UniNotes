import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, createModule, createNote, createTestEnv, loggedInClient, type TestEnv } from './helpers.js';

let env: TestEnv;
let c: Client;
beforeEach(async () => {
  env = createTestEnv({ VERSION_INTERVAL_MINUTES: '0' });
  c = await loggedInClient(env);
});
afterEach(() => env.cleanup());

const search = async (q: string, extra = '') =>
  (await c.get(`/api/search?q=${encodeURIComponent(q)}${extra}`)).body;

describe('notes CRUD', () => {
  it('creates, reads, updates and lists notes', async () => {
    const m = await createModule(c);
    const n = await createNote(c, { title: '  ', moduleId: m.id, tags: ['Graphs', 'graphs', 'exam'] });
    expect(n.title).toBe('Untitled note');
    const got = await c.get(`/api/notes/${n.id}`);
    expect(got.body.data.tags).toEqual(['exam', 'graphs']);
    expect(got.body.data.module.name).toBe('Algorithms');

    const upd = await c.patch(`/api/notes/${n.id}`, {
      revision: 1,
      title: 'Graphs',
      markdownContent: '# BFS',
    });
    expect(upd.status).toBe(200);
    expect(upd.body.data.revision).toBe(2);

    const list = await c.get('/api/notes?pageSize=10');
    expect(list.body.meta).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect(list.body.data[0]).not.toHaveProperty('markdownContent');
    expect(list.body.data[0].excerpt).toBe('BFS');
  });

  it('validates input', async () => {
    expect((await c.post('/api/notes', { lectureDate: '2025-02-30' })).status).toBe(400);
    expect((await c.post('/api/notes', { lectureDate: 'yesterday' })).status).toBe(400);
    expect((await c.post('/api/notes', { lectureDate: '2025-01-01', moduleId: 'not-a-uuid' })).status).toBe(
      400,
    );
    expect((await c.post('/api/notes', { lectureDate: '2025-01-01', tags: ['<script>'] })).status).toBe(400);
    expect((await c.get('/api/notes/not-a-uuid')).status).toBe(400);
    expect((await c.get('/api/notes?pageSize=1000')).status).toBe(400);
    const n = await createNote(c);
    const r = await c.patch(`/api/notes/${n.id}`, { markdownContent: 'no revision' });
    expect(r.status).toBe(400);
  });

  it('rejects assigning another user’s module', async () => {
    const other = new Client(env);
    await (await import('./helpers.js')).seedUser(env, 'other');
    await other.login('other');
    const m = await createModule(other);
    expect((await c.post('/api/notes', { lectureDate: '2025-01-01', moduleId: m.id })).status).toBe(404);
  });

  it('pagination works', async () => {
    for (let i = 0; i < 5; i++) await createNote(c, { title: `N${i}` });
    const p1 = await c.get('/api/notes?pageSize=2&page=1&sort=title');
    const p3 = await c.get('/api/notes?pageSize=2&page=3&sort=title');
    expect(p1.body.data.map((n: { title: string }) => n.title)).toEqual(['N0', 'N1']);
    expect(p3.body.data.map((n: { title: string }) => n.title)).toEqual(['N4']);
    expect(p1.body.meta.total).toBe(5);
  });
});

describe('revision conflicts', () => {
  it('returns 409 with the server copy and does not overwrite', async () => {
    const n = await createNote(c, { markdownContent: 'v1' });
    expect((await c.patch(`/api/notes/${n.id}`, { revision: 1, markdownContent: 'tab A' })).status).toBe(200);
    const stale = await c.patch(`/api/notes/${n.id}`, { revision: 1, markdownContent: 'tab B' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('REVISION_CONFLICT');
    expect(stale.body.error.details.current.markdownContent).toBe('tab A');
    expect(stale.body.error.details.current.revision).toBe(2);
    expect((await c.get(`/api/notes/${n.id}`)).body.data.markdownContent).toBe('tab A');
    // Explicit overwrite after the user resolves the conflict.
    expect((await c.patch(`/api/notes/${n.id}`, { revision: 2, markdownContent: 'tab B' })).status).toBe(200);
  });

  it('metadata-only changes do not bump the revision', async () => {
    const n = await createNote(c);
    const fav = await c.patch(`/api/notes/${n.id}`, { isFavourite: true });
    expect(fav.body.data.revision).toBe(1);
    expect(fav.body.data.isFavourite).toBe(true);
    expect((await c.patch(`/api/notes/${n.id}`, { revision: 1, markdownContent: 'x' })).status).toBe(200);
  });
});

describe('versions', () => {
  it('records versions and restores as a new revision', async () => {
    const n = await createNote(c, { markdownContent: 'original' });
    await c.patch(`/api/notes/${n.id}`, { revision: 1, markdownContent: 'second' });
    await c.patch(`/api/notes/${n.id}`, { revision: 2, markdownContent: 'third' });
    const versions = (await c.get(`/api/notes/${n.id}/versions`)).body.data;
    expect(versions.length).toBeGreaterThanOrEqual(2);
    const original = versions.find((v: { revision: number }) => v.revision === 1);
    const detail = await c.get(`/api/notes/${n.id}/versions/${original.id}`);
    expect(detail.body.data.markdownContent).toBe('original');

    const restored = await c.post(`/api/notes/${n.id}/versions/${original.id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.data.markdownContent).toBe('original');
    expect(restored.body.data.revision).toBe(4);
    const after = (await c.get(`/api/notes/${n.id}/versions`)).body.data;
    // History is preserved: the pre-restore content is still available.
    const pre = after.find((v: { reason: string }) => v.reason === 'pre-restore');
    expect((await c.get(`/api/notes/${n.id}/versions/${pre.id}`)).body.data.markdownContent).toBe('third');
  });

  it('respects the retention limit', async () => {
    const env2 = createTestEnv({ VERSION_INTERVAL_MINUTES: '0', VERSION_RETENTION: '5' });
    const c2 = await loggedInClient(env2);
    const n = await createNote(c2);
    for (let r = 1; r <= 8; r++)
      await c2.patch(`/api/notes/${n.id}`, { revision: r, markdownContent: `v${r}` });
    expect((await c2.get(`/api/notes/${n.id}/versions`)).body.data).toHaveLength(5);
    env2.cleanup();
  });

  it('throttles autosave versions by interval', async () => {
    const env2 = createTestEnv({ VERSION_INTERVAL_MINUTES: '10' });
    const c2 = await loggedInClient(env2);
    const n = await createNote(c2);
    for (let r = 1; r <= 5; r++)
      await c2.patch(`/api/notes/${n.id}`, { revision: r, markdownContent: `v${r}` });
    expect((await c2.get(`/api/notes/${n.id}/versions`)).body.data).toHaveLength(1);
    expect((await c2.post(`/api/notes/${n.id}/versions`)).status).toBe(201);
    expect((await c2.get(`/api/notes/${n.id}/versions`)).body.data).toHaveLength(2);
    env2.cleanup();
  });
});

describe('archive, recycle bin and permanent deletion', () => {
  it('archive is distinct from deletion', async () => {
    const n = await createNote(c);
    await c.post(`/api/notes/${n.id}/archive`);
    expect((await c.get('/api/notes')).body.meta.total).toBe(0);
    expect((await c.get('/api/notes?status=archived')).body.meta.total).toBe(1);
    expect((await c.get('/api/notes?status=deleted')).body.meta.total).toBe(0);
    await c.post(`/api/notes/${n.id}/unarchive`);
    expect((await c.get('/api/notes')).body.meta.total).toBe(1);
  });

  it('soft deletes, restores and permanently deletes', async () => {
    const n = await createNote(c, { markdownContent: 'zebra' });
    expect((await c.delete(`/api/notes/${n.id}`)).status).toBe(204);
    expect((await c.get(`/api/notes/${n.id}`)).status).toBe(404);
    expect((await c.get(`/api/notes/${n.id}?includeDeleted=true`)).status).toBe(200);
    expect((await search('zebra')).data).toHaveLength(0);
    expect((await search('zebra', '&status=deleted')).data).toHaveLength(1);
    await c.post(`/api/notes/${n.id}/restore`);
    expect((await search('zebra')).data).toHaveLength(1);

    // Only notes already in the bin can be permanently deleted.
    expect((await c.post('/api/notes/permanent-delete', { ids: [n.id] })).body.data.deleted).toBe(0);
    await c.delete(`/api/notes/${n.id}`);
    expect((await c.post('/api/notes/permanent-delete', { ids: [n.id] })).body.data.deleted).toBe(1);
    expect((await c.get(`/api/notes/${n.id}?includeDeleted=true`)).status).toBe(404);
    const fts = env.ctx.db.$client.prepare('SELECT COUNT(*) AS n FROM notes_fts').get() as { n: number };
    expect(fts.n).toBe(0);
    const versions = env.ctx.db.$client.prepare('SELECT COUNT(*) AS n FROM note_versions').get() as {
      n: number;
    };
    expect(versions.n).toBe(0);
  });

  it('empties the whole bin', async () => {
    for (let i = 0; i < 3; i++) await c.delete(`/api/notes/${(await createNote(c)).id}`);
    expect((await c.post('/api/notes/permanent-delete', { all: true })).body.data.deleted).toBe(3);
  });
});

describe('search index', () => {
  it('indexes title, content, tags and module, and stays in sync', async () => {
    const m = await createModule(c, { name: 'Thermodynamics', code: 'PHY210' });
    const n = await createNote(c, {
      title: 'Entropy lecture',
      markdownContent: 'Carnot cycle efficiency',
      tags: ['exam'],
      moduleId: m.id,
    });
    expect((await search('entropy')).data).toHaveLength(1);
    expect((await search('carnot')).data).toHaveLength(1);
    expect((await search('exam')).data).toHaveLength(1);
    expect((await search('thermodynamics')).data).toHaveLength(1);
    expect((await search('phy210')).data).toHaveLength(1);
    expect((await search('carn')).data).toHaveLength(1); // prefix

    await c.patch(`/api/notes/${n.id}`, { revision: 1, markdownContent: 'Rankine cycle' });
    expect((await search('carnot')).data).toHaveLength(0);
    expect((await search('rankine')).data).toHaveLength(1);

    await c.patch(`/api/modules/${m.id}`, { name: 'Heat Engines' });
    expect((await search('thermodynamics')).data).toHaveLength(0);
    expect((await search('heat engines')).data).toHaveLength(1);

    await c.patch(`/api/notes/${n.id}`, { tags: ['revision'] });
    expect((await search('exam')).data).toHaveLength(0);

    await c.delete(`/api/modules/${m.id}`, { confirmName: 'Heat Engines' });
    expect((await search('heat')).data).toHaveLength(0);
    expect((await search('rankine')).data).toHaveLength(1);
  });

  it('returns snippets with safe highlight markers and handles hostile queries', async () => {
    await createNote(c, { title: 'T', markdownContent: 'The <b>quick</b> brown fox' });
    const r = await search('quick');
    expect(r.data[0].snippet).toContain('\u0001quick\u0002');
    for (const q of ['"', 'NEAR(', 'title:x', '*', 'a OR', "'; DROP TABLE notes; --"]) {
      expect((await c.get(`/api/search?q=${encodeURIComponent(q)}`)).status).toBe(200);
    }
  });

  it('applies filters and sorting', async () => {
    const m = await createModule(c);
    await createNote(c, {
      title: 'B alpha',
      lectureDate: '2025-01-10',
      moduleId: m.id,
      tags: ['x'],
      isFavourite: true,
    });
    await createNote(c, { title: 'A alpha', lectureDate: '2025-03-10' });
    await createNote(c, { title: 'C alpha', lectureDate: '2025-02-10', moduleId: m.id });
    const titles = (b: { data: { title: string }[] }) => b.data.map((n) => n.title);
    expect(titles(await search('alpha', '&sort=lecture_asc'))).toEqual(['B alpha', 'C alpha', 'A alpha']);
    expect(titles(await search('alpha', '&sort=lecture_desc'))).toEqual(['A alpha', 'C alpha', 'B alpha']);
    expect(titles(await search('alpha', '&sort=title'))).toEqual(['A alpha', 'B alpha', 'C alpha']);
    expect(titles(await search('alpha', `&moduleId=${m.id}&sort=title`))).toEqual(['B alpha', 'C alpha']);
    expect(titles(await search('alpha', '&moduleId=none'))).toEqual(['A alpha']);
    expect(titles(await search('alpha', '&favourite=true'))).toEqual(['B alpha']);
    expect(titles(await search('alpha', '&tags=x'))).toEqual(['B alpha']);
    expect(titles(await search('alpha', '&from=2025-02-01&to=2025-02-28'))).toEqual(['C alpha']);
    expect(titles(await search('alpha', '&date=2025-03-10'))).toEqual(['A alpha']);
    expect(titles(await search('alpha', '&academicYear=2025%2F26&sort=title'))).toEqual([
      'B alpha',
      'C alpha',
    ]);
    expect(titles(await search('', '&sort=title'))).toEqual(['A alpha', 'B alpha', 'C alpha']);
  });
});

describe('calendar, tags and dashboard', () => {
  it('groups notes by lecture date, not creation time', async () => {
    const m = await createModule(c);
    await createNote(c, { lectureDate: '2019-05-01', moduleId: m.id });
    await createNote(c, { lectureDate: '2019-05-01' });
    await createNote(c, { lectureDate: '2019-05-20', moduleId: m.id });
    const res = await c.get('/api/calendar?from=2019-05-01&to=2019-05-31');
    expect(res.body.data).toEqual([
      { date: '2019-05-01', count: 2, modules: [{ id: m.id, color: '#3B82F6', count: 1 }] },
      { date: '2019-05-20', count: 1, modules: [{ id: m.id, color: '#3B82F6', count: 1 }] },
    ]);
    const filtered = await c.get(`/api/calendar?from=2019-05-01&to=2019-05-31&moduleId=${m.id}`);
    expect(filtered.body.data.map((d: { count: number }) => d.count)).toEqual([1, 1]);
    expect((await c.get('/api/calendar?from=2019-05-31&to=2019-05-01')).status).toBe(400);
  });

  it('lists tags with counts', async () => {
    await createNote(c, { tags: ['a', 'b'] });
    await createNote(c, { tags: ['a'] });
    expect((await c.get('/api/tags')).body.data).toEqual([
      { name: 'a', count: 2 },
      { name: 'b', count: 1 },
    ]);
  });

  it('dashboard summarises activity', async () => {
    const m = await createModule(c);
    await createNote(c, { moduleId: m.id });
    const d = (await c.get('/api/dashboard')).body.data;
    expect(d.stats.totalNotes).toBe(1);
    expect(d.stats.totalModules).toBe(1);
    expect(d.stats.notesThisWeek).toBe(1);
    expect(d.stats.recentlyActiveModule.id).toBe(m.id);
    expect(d.recentNotes).toHaveLength(1);
  });
});

describe('modules', () => {
  it('creates, edits, archives, restores and deletes with confirmation', async () => {
    const m = await createModule(c, { color: '#10b981' });
    expect(m).toMatchObject({ name: 'Algorithms' });
    await createNote(c, { moduleId: m.id });
    expect(
      (await c.patch(`/api/modules/${m.id}`, { description: 'Graphs and more' })).body.data.noteCount,
    ).toBe(1);
    await c.post(`/api/modules/${m.id}/archive`);
    expect((await c.get('/api/modules')).body.data).toHaveLength(0);
    expect((await c.get('/api/modules?status=archived')).body.data).toHaveLength(1);
    await c.post(`/api/modules/${m.id}/unarchive`);
    expect((await c.delete(`/api/modules/${m.id}`, { confirmName: 'wrong' })).status).toBe(400);
    const del = await c.delete(`/api/modules/${m.id}`, { confirmName: 'Algorithms' });
    expect(del.body.data.notesUnassigned).toBe(1);
    expect((await c.get('/api/notes?moduleId=none')).body.meta.total).toBe(1);
  });

  it('validates colour', async () => {
    expect((await c.post('/api/modules', { name: 'X', color: 'red; background:url(x)' })).status).toBe(400);
  });
});
