import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import sharp from 'sharp';
import { Client, createNote, createTestEnv, loggedInClient, type TestEnv } from './helpers.js';
import { EXE, HTML, JPEG_WITH_EXIF, LARGE_PNG, PDF, PNG_1x1, POLYGLOT_PNG, SVG } from './fixtures.js';
import { storagePath } from '../src/services/attachments.service.js';

let env: TestEnv;
let c: Client;
let noteId: string;
beforeEach(async () => {
  env = createTestEnv({ MAX_IMAGE_MB: '1', MAX_ATTACHMENT_MB: '1' });
  c = await loggedInClient(env);
  noteId = (await createNote(c)).id;
});
afterEach(() => env.cleanup());

const up = (buffer: Buffer, name: string) => c.upload('/api/attachments', { noteId }, { buffer, name });

describe('image uploads', () => {
  it('accepts PNG and serves it inline with safe headers', async () => {
    const res = await up(PNG_1x1, 'shot.png');
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ kind: 'image', mimeType: 'image/png', width: 1, height: 1 });
    expect(res.body.data.url).toBe(`/api/attachments/${res.body.data.id}/content`);
    const get = await c.get(res.body.data.url);
    expect(get.status).toBe(200);
    expect(get.headers['content-type']).toBe('image/png');
    expect(get.headers['x-content-type-options']).toBe('nosniff');
    expect(get.headers['content-disposition']).toMatch(/^inline/);
    expect(get.headers['content-security-policy']).toContain('sandbox');
    expect(get.headers['cache-control']).toContain('private');
  });

  it('re-encodes JPEGs and strips EXIF metadata', async () => {
    expect(JPEG_WITH_EXIF.includes('SECRET-EXIF-MARKER')).toBe(true);
    const res = await up(JPEG_WITH_EXIF, 'photo.jpg');
    expect(res.status).toBe(201);
    const body = (await c.get(res.body.data.url).buffer(true)).body as Buffer;
    expect(body.includes('SECRET-EXIF-MARKER')).toBe(false);
    expect((await sharp(body).metadata()).exif).toBeUndefined();
  });

  it('removes payloads appended to images (polyglots)', async () => {
    const res = await up(POLYGLOT_PNG, 'poly.png');
    expect(res.status).toBe(201);
    const body = (await c.get(res.body.data.url).buffer(true)).body as Buffer;
    expect(body.includes('<script>')).toBe(false);
  });

  it('downscales oversized dimensions', async () => {
    const res = await up(LARGE_PNG, 'wide.png');
    expect(res.body.data.width).toBe(4096);
  });

  it('ignores the client file name/extension and sniffs content', async () => {
    const res = await up(PNG_1x1, 'notes.exe');
    expect(res.status).toBe(201);
    expect(res.body.data.originalName).toBe('notes.png');
  });
});

describe('rejected uploads', () => {
  it.each([
    ['SVG', SVG, 'image.svg'],
    ['HTML disguised as PNG', HTML, 'image.png'],
    ['executable', EXE, 'image.png'],
    ['text', Buffer.from('hello'), 'a.txt'],
  ])('rejects %s', async (_label, buf, name) => {
    const res = await up(buf, name);
    expect(res.status).toBe(415);
    expect(fs.readdirSync(env.ctx.config.paths.attachments)).toHaveLength(0);
  });

  it('rejects oversized files', async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(2 * 1024 * 1024, 0x20)]);
    const res = await up(big, 'big.pdf');
    expect(res.status).toBe(413);
  });

  it('requires a file and a valid note', async () => {
    const res = await c.post('/api/attachments', { noteId });
    expect(res.status).toBe(400);
    const bad = await c.upload(
      '/api/attachments',
      { noteId: '00000000-0000-4000-8000-000000000000' },
      { buffer: PNG_1x1, name: 'a.png' },
    );
    expect(bad.status).toBe(404);
  });
});

describe('documents', () => {
  it('accepts PDF and always serves it as a download', async () => {
    const res = await up(PDF, '../../Lecture Slides.pdf');
    expect(res.status).toBe(201);
    expect(res.body.data.originalName).toBe('Lecture Slides.pdf');
    const get = await c.get(res.body.data.url);
    expect(get.headers['content-type']).toBe('application/pdf');
    expect(get.headers['content-disposition']).toMatch(/^attachment; filename="Lecture Slides.pdf"/);
    const list = await c.get(`/api/notes/${noteId}/attachments`);
    expect(list.body.data).toHaveLength(1);
  });
});

describe('storage safety', () => {
  it('stores files under opaque names inside the attachments dir', async () => {
    const res = await up(PNG_1x1, '../../../etc/passwd.png');
    const files = fs.readdirSync(env.ctx.config.paths.attachments);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(res.body.data).not.toHaveProperty('storageKey');
  });

  it('blocks path traversal in storage keys', () => {
    expect(() => storagePath(env.ctx, '../../etc/passwd')).toThrow();
    expect(() => storagePath(env.ctx, '..%2f..%2fetc')).toThrow();
    expect(() => storagePath(env.ctx, 'a'.repeat(32))).not.toThrow();
  });

  it('deletes attachments and their files', async () => {
    const res = await up(PNG_1x1, 'a.png');
    expect((await c.delete(`/api/attachments/${res.body.data.id}`)).status).toBe(204);
    expect(fs.readdirSync(env.ctx.config.paths.attachments)).toHaveLength(0);
    expect((await c.get(res.body.data.url)).status).toBe(404);
  });

  it('permanent note deletion removes unreferenced files but keeps shared ones', async () => {
    const a = await up(PNG_1x1, 'a.png');
    const b = await up(PNG_1x1, 'b.png');
    const other = await createNote(c, { markdownContent: `![](${b.body.data.url})` });
    await c.delete(`/api/notes/${noteId}`);
    await c.post('/api/notes/permanent-delete', { ids: [noteId] });
    expect((await c.get(a.body.data.url)).status).toBe(404);
    expect((await c.get(b.body.data.url)).status).toBe(200);
    expect((await c.get(`/api/attachments/${b.body.data.id}`)).body.data.noteId).toBe(other.id);
    expect(fs.readdirSync(env.ctx.config.paths.attachments)).toHaveLength(1);
  });
});
