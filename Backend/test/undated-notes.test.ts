import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, createModule, createNote, createTestEnv, loggedInClient, type TestEnv } from './helpers.js';
import { binaryParser, readZip } from './zip.js';

let env: TestEnv;
let c: Client;
beforeEach(async () => {
  env = createTestEnv();
  c = await loggedInClient(env);
});
afterEach(() => env.cleanup());

describe('undated notes (lecture_date = null)', () => {
  it('creates, clears and re-assigns a lecture date', async () => {
    const n = await createNote(c, { title: 'Undated', lectureDate: null });
    expect((await c.get(`/api/notes/${n.id}`)).body.data.lectureDate).toBeNull();
    const set = await c.patch(`/api/notes/${n.id}`, { lectureDate: '2024-02-13' });
    expect(set.body.data.lectureDate).toBe('2024-02-13');
    const cleared = await c.patch(`/api/notes/${n.id}`, { lectureDate: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.lectureDate).toBeNull();
    // Metadata-only change: no revision bump, so autosave is unaffected.
    expect(cleared.body.data.revision).toBe(n.revision);
    const saved = await c.patch(`/api/notes/${n.id}`, { revision: n.revision, markdownContent: 'edited' });
    expect(saved.status).toBe(200);
    expect(saved.body.data.lectureDate).toBeNull();
  });

  it('still rejects invalid dates', async () => {
    expect((await c.post('/api/notes', { title: 'x', lectureDate: '2024-02-30' })).status).toBe(400);
    expect((await c.post('/api/notes', { title: 'x', lectureDate: '' })).status).toBe(400);
  });

  it('sorts undated notes last in both lecture orders', async () => {
    await createNote(c, { title: 'Undated', lectureDate: null });
    await createNote(c, { title: 'Early', lectureDate: '2023-10-01' });
    await createNote(c, { title: 'Late', lectureDate: '2025-10-01' });
    const titles = async (sort: string) =>
      (await c.get(`/api/notes?sort=${sort}`)).body.data.map((n: { title: string }) => n.title);
    expect(await titles('lecture_desc')).toEqual(['Late', 'Early', 'Undated']);
    expect(await titles('lecture_asc')).toEqual(['Early', 'Late', 'Undated']);
  });

  it('is excluded from the calendar and date filters but found by module and search', async () => {
    const m = await createModule(c);
    const n = await createNote(c, {
      title: 'Normalisation',
      markdownContent: 'third normal form',
      lectureDate: null,
      moduleId: m.id,
    });
    await createNote(c, { title: 'Dated', lectureDate: '2024-03-12', moduleId: m.id });
    const cal = await c.get('/api/calendar?from=2024-01-01&to=2024-12-31');
    expect(cal.status).toBe(200);
    expect(cal.body.data).toEqual([expect.objectContaining({ date: '2024-03-12', count: 1 })]);
    const ranged = await c.get('/api/notes?from=1900-01-01&to=2999-12-31');
    expect(ranged.body.data.map((x: { id: string }) => x.id)).not.toContain(n.id);
    const byModule = await c.get(`/api/notes?moduleId=${m.id}`);
    expect(byModule.body.data.map((x: { id: string }) => x.id)).toContain(n.id);
    const search = await c.get('/api/search?q=normal');
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0].id).toBe(n.id);
    expect(search.body.data[0].lectureDate).toBeNull();
  });

  it('dashboard lists undated notes', async () => {
    const n = await createNote(c, { title: 'Undated', lectureDate: null });
    const res = await c.get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.data.recentNotes.map((x: { id: string }) => x.id)).toContain(n.id);
  });

  it('exports undated notes with a null date and an "undated" file name', async () => {
    const m = await createModule(c);
    const n = await createNote(c, { title: 'No Date', lectureDate: null, moduleId: m.id });
    const md = await c.get(`/api/export/notes/${n.id}/markdown`);
    expect(md.status).toBe(200);
    expect(md.text).toContain('lecture_date: null');
    expect(md.headers['content-disposition']).toContain('undated-no-date.md');
    const zip = await c.get(`/api/export/modules/${m.id}/zip`).buffer(true).parse(binaryParser);
    const files = [...(await readZip(zip.body as Buffer)).keys()];
    expect(files.some((f) => f.endsWith('/undated-no-date.md'))).toBe(true);
  });

  it('imports Markdown without a date as an undated note', async () => {
    const res = await c.upload('/api/import', {}, { buffer: Buffer.from('# Hello'), name: 'a.md' });
    expect(res.status).toBe(201);
    expect(res.body.data.lectureDate).toBeNull();
    const blank = await c.upload(
      '/api/import',
      { lectureDate: '' },
      { buffer: Buffer.from('# Two'), name: 'b.md' },
    );
    expect(blank.body.data.lectureDate).toBeNull();
    const bad = await c.upload(
      '/api/import',
      { lectureDate: 'nope' },
      { buffer: Buffer.from('# 3'), name: 'c.md' },
    );
    expect(bad.status).toBe(400);
  });
});
