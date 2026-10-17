import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, createModule, createNote, createTestEnv, loggedInClient, type TestEnv } from './helpers.js';
import { PNG_1x1 } from './fixtures.js';

let env: TestEnv;
let alice: Client;
let bob: Client;
beforeEach(async () => {
  env = createTestEnv();
  alice = await loggedInClient(env, 'alice');
  bob = await loggedInClient(env, 'bobby');
});
afterEach(() => env.cleanup());

describe('cross-user isolation', () => {
  it('another user cannot read, modify or delete notes', async () => {
    const n = await createNote(alice, { title: 'Private', markdownContent: 'secret stuff' });
    expect((await bob.get(`/api/notes/${n.id}`)).status).toBe(404);
    expect((await bob.patch(`/api/notes/${n.id}`, { revision: 1, markdownContent: 'pwned' })).status).toBe(
      404,
    );
    expect((await bob.patch(`/api/notes/${n.id}`, { isFavourite: true })).status).toBe(404);
    expect((await bob.delete(`/api/notes/${n.id}`)).status).toBe(404);
    expect((await bob.post(`/api/notes/${n.id}/archive`)).status).toBe(404);
    expect((await bob.get(`/api/notes/${n.id}/versions`)).status).toBe(404);
    expect((await bob.get(`/api/export/notes/${n.id}/markdown`)).status).toBe(404);
    expect((await bob.get(`/api/export/notes/${n.id}/zip`)).status).toBe(404);
    expect((await bob.get('/api/search?q=secret')).body.data).toHaveLength(0);
    expect((await bob.get('/api/notes')).body.data).toHaveLength(0);
    expect((await bob.get('/api/calendar?from=2025-01-01&to=2025-12-31')).body.data).toHaveLength(0);
    await alice.delete(`/api/notes/${n.id}`);
    expect((await bob.post(`/api/notes/${n.id}/restore`)).status).toBe(404);
    expect((await bob.post('/api/notes/permanent-delete', { ids: [n.id] })).body.data.deleted).toBe(0);
    expect((await alice.get(`/api/notes/${n.id}?includeDeleted=true`)).body.data.markdownContent).toBe(
      'secret stuff',
    );
  });

  it('another user cannot access modules', async () => {
    const m = await createModule(alice);
    expect((await bob.get(`/api/modules/${m.id}`)).status).toBe(404);
    expect((await bob.patch(`/api/modules/${m.id}`, { name: 'x' })).status).toBe(404);
    expect((await bob.delete(`/api/modules/${m.id}`, { confirmName: 'Algorithms' })).status).toBe(404);
    expect((await bob.get(`/api/export/modules/${m.id}/zip`)).status).toBe(404);
    expect((await bob.get('/api/modules')).body.data).toHaveLength(0);
  });

  it('another user cannot access attachments or upload to foreign notes', async () => {
    const n = await createNote(alice);
    const up = await alice.upload('/api/attachments', { noteId: n.id }, { buffer: PNG_1x1, name: 'a.png' });
    expect(up.status).toBe(201);
    const id = up.body.data.id;
    expect((await bob.get(`/api/attachments/${id}/content`)).status).toBe(404);
    expect((await bob.get(`/api/attachments/${id}`)).status).toBe(404);
    expect((await bob.delete(`/api/attachments/${id}`)).status).toBe(404);
    expect(
      (await bob.upload('/api/attachments', { noteId: n.id }, { buffer: PNG_1x1, name: 'b.png' })).status,
    ).toBe(404);
    expect((await alice.get(`/api/attachments/${id}/content`)).status).toBe(200);
  });
});
