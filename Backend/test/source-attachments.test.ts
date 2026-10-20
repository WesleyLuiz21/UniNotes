import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, createNote, createTestEnv, loggedInClient, type TestEnv } from './helpers.js';
import { EXE, PDF, PNG_1x1 } from './fixtures.js';
import { binaryParser, readZip } from './zip.js';

let env: TestEnv;
let c: Client;
let noteId: string;
beforeEach(async () => {
  env = createTestEnv();
  c = await loggedInClient(env);
  noteId = (await createNote(c)).id;
});
afterEach(() => env.cleanup());

const up = (buffer: Buffer, name: string, client = c, id = noteId) =>
  client.upload('/api/attachments', { noteId: id }, { buffer, name });
const download = (url: string, client = c) => client.get(url).buffer(true).parse(binaryParser);

const C_SOURCE = Buffer.from('#include <stdio.h>\r\nint main(void) {\n\tprintf("héllo ✓\\n");\n}\n');
const ELF = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), Buffer.alloc(120, 0)]);
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(60, 0x41)]);

describe('source-code attachments', () => {
  it.each(['.c', '.h', '.py', '.js', '.ts', '.html'])(
    'accepts %s and keeps the bytes exactly',
    async (ext) => {
      const res = await up(C_SOURCE, `exercise${ext}`);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        kind: 'file',
        mimeType: 'text/plain',
        originalName: `exercise${ext}`,
        sizeBytes: C_SOURCE.length,
        width: null,
      });
      const get = await download(res.body.data.url);
      expect(get.status).toBe(200);
      expect(Buffer.compare(get.body as Buffer, C_SOURCE)).toBe(0);
    },
  );

  it('serves HTML and JavaScript only as plain-text downloads', async () => {
    const html = Buffer.from('<!doctype html><script>alert(document.cookie)</script>');
    for (const name of ['page.html', 'app.js']) {
      const res = await up(html, name);
      expect(res.status).toBe(201);
      for (const url of [res.body.data.url, `${res.body.data.url}?download=1`]) {
        const get = await c.get(url);
        expect(get.headers['content-type']).toMatch(/^text\/plain/);
        expect(get.headers['content-disposition']).toMatch(new RegExp(`^attachment; filename="${name}"`));
        expect(get.headers['x-content-type-options']).toBe('nosniff');
        expect(get.headers['content-security-policy']).toContain('sandbox');
        expect(get.headers['content-security-policy']).toContain("default-src 'none'");
      }
    }
  });

  it.each([
    ['an ELF executable renamed to .c', ELF, 'exercise.c'],
    ['a Windows executable renamed to .js', EXE, 'script.js'],
    ['a ZIP archive renamed to .py', ZIP, 'test.py'],
    ['text containing NUL bytes', Buffer.from('int x;\0\0'), 'a.c'],
    ['invalid UTF-8', Buffer.from([0x69, 0x6e, 0x74, 0xff, 0xfe, 0x0a]), 'a.c'],
    ['an empty file', Buffer.alloc(0), 'empty.c'],
    ['a disallowed extension', Buffer.from('echo hi'), 'run.sh'],
    ['a disallowed extension (.txt)', Buffer.from('notes'), 'a.txt'],
  ])('rejects %s', async (_label, buffer, name) => {
    const res = await up(buffer, name);
    expect([400, 415]).toContain(res.status);
    if (name !== 'empty.c') expect(res.status).toBe(415);
    expect(fs.readdirSync(env.ctx.config.paths.attachments)).toHaveLength(0);
  });

  it('enforces the 1 MB source limit', async () => {
    expect((await up(Buffer.alloc(1024 * 1024, 0x61), 'max.c')).status).toBe(201);
    const res = await up(Buffer.alloc(1024 * 1024 + 1, 0x61), 'big.c');
    expect(res.status).toBe(413);
  });

  it('keeps image and PDF behaviour unchanged', async () => {
    const png = await up(PNG_1x1, 'shot.c');
    expect(png.body.data).toMatchObject({ kind: 'image', mimeType: 'image/png', originalName: 'shot.png' });
    const pdf = await up(PDF, 'slides.pdf');
    expect(pdf.body.data).toMatchObject({ kind: 'file', mimeType: 'application/pdf' });
    // Content sniffing wins over the name: a real PDF called .ts stays a PDF, never "source".
    const renamed = await up(PDF, 'grade.ts');
    expect(renamed.body.data).toMatchObject({ mimeType: 'application/pdf', originalName: 'grade.pdf' });
  });

  it('enforces ownership', async () => {
    const res = await up(C_SOURCE, 'mine.c');
    const bob = await loggedInClient(env, 'bob');
    expect((await bob.get(res.body.data.url)).status).toBe(404);
    expect((await bob.get(`/api/attachments/${res.body.data.id}`)).status).toBe(404);
    expect((await bob.delete(`/api/attachments/${res.body.data.id}`)).status).toBe(404);
    expect((await up(C_SOURCE, 'x.c', bob)).status).toBe(404);
    expect((await c.get(res.body.data.url)).status).toBe(200);
  });

  it('includes source files, byte-for-byte, in note and full exports', async () => {
    const res = await up(C_SOURCE, 'exercise.c');
    const link = `[📎 exercise.c](${res.body.data.url}?download=1)`;
    const n = await c.patch(`/api/notes/${noteId}`, { revision: 1, markdownContent: `Code: ${link}` });
    expect(n.status).toBe(200);

    const zip = await download(`/api/export/notes/${noteId}/zip`);
    const files = await readZip(zip.body as Buffer);
    const md = [...files.entries()].find(([k]) => k.endsWith('.md'))![1].toString();
    const rel = /\]\((assets\/[^)?]+)/.exec(md)![1]!;
    expect(rel).toMatch(/exercise\.c$/);
    const dir = [...files.keys()].find((k) => k.endsWith('.md'))!.replace(/[^/]+$/, '');
    expect(Buffer.compare(files.get(dir + rel)!, C_SOURCE)).toBe(0);

    const all = await download('/api/export/all');
    const allFiles = await readZip(all.body as Buffer);
    const asset = [...allFiles.entries()].find(([k]) => k.endsWith('exercise.c'));
    expect(asset).toBeDefined();
    expect(Buffer.compare(asset![1], C_SOURCE)).toBe(0);
  });
});
