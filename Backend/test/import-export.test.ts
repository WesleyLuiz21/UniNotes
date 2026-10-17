import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, createModule, createNote, createTestEnv, loggedInClient, type TestEnv } from './helpers.js';
import { PDF, PNG_1x1 } from './fixtures.js';
import { binaryParser, readZip } from './zip.js';

let env: TestEnv;
let c: Client;
beforeEach(async () => {
  env = createTestEnv({ MAX_IMPORT_MB: '0.01' });
  c = await loggedInClient(env);
});
afterEach(() => env.cleanup());

const importMd = (content: string | Buffer, name = 'lecture.md', fields: Record<string, string> = {}) =>
  c.upload('/api/import', { lectureDate: '2024-11-05', ...fields }, { buffer: Buffer.from(content), name });

describe('Markdown import', () => {
  it('imports a file preserving content and inferring the title', async () => {
    const md = '# Week 3: Recursion\n\nSome *notes* with <b>html</b> and $x^2$.\r\n';
    const m = await createModule(c);
    const res = await importMd(md, 'week3.md', { moduleId: m.id, tags: 'cs,recursion' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      title: 'Week 3: Recursion',
      lectureDate: '2024-11-05',
      moduleId: m.id,
      tags: ['cs', 'recursion'],
    });
    expect(res.body.data.markdownContent).toBe(
      '# Week 3: Recursion\n\nSome *notes* with <b>html</b> and $x^2$.\n',
    );
    const versions = await c.get(`/api/notes/${res.body.data.id}/versions`);
    expect(versions.body.data[0].reason).toBe('import');
  });

  it('uses the title override and file name fallback', async () => {
    expect((await importMd('no heading', 'my_lecture-notes.md')).body.data.title).toBe('my lecture notes');
    expect((await importMd('# H', 'x.md', { title: 'Custom' })).body.data.title).toBe('Custom');
  });

  it('detects duplicates and never overwrites', async () => {
    const first = await importMd('# Same\ncontent');
    const dup = await importMd('# Same\ncontent');
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_IMPORT');
    expect(dup.body.error.details.existing.id).toBe(first.body.data.id);
    const forced = await importMd('# Same\ncontent', 'lecture.md', { allowDuplicate: 'true' });
    expect(forced.status).toBe(201);
    expect(forced.body.data.id).not.toBe(first.body.data.id);
    expect((await c.get('/api/notes')).body.meta.total).toBe(2);
  });

  it('rejects invalid files', async () => {
    expect((await importMd(Buffer.from([0xff, 0xfe, 0x00, 0x41]), 'bad.md')).status).toBe(415);
    expect((await importMd('hello\u0000world', 'bin.md')).status).toBe(415);
    expect((await importMd('# ok', 'script.js')).status).toBe(415);
    expect((await importMd('', 'empty.md')).status).toBe(400);
    expect((await importMd('x'.repeat(20_000), 'big.md')).status).toBe(413);
    expect(
      (await c.upload('/api/import', { lectureDate: 'nope' }, { buffer: Buffer.from('# a'), name: 'a.md' }))
        .status,
    ).toBe(400);
  });
});

describe('export', () => {
  async function noteWithImage() {
    const m = await createModule(c, { name: 'Physics 101', code: 'PHY101' });
    const n = await createNote(c, {
      title: 'Waves & Optics',
      moduleId: m.id,
      tags: ['exam'],
      lectureDate: '2025-02-03',
    });
    const img = (
      await c.upload('/api/attachments', { noteId: n.id }, { buffer: PNG_1x1, name: 'Diagram 1.png' })
    ).body.data;
    const pdf = (await c.upload('/api/attachments', { noteId: n.id }, { buffer: PDF, name: 'slides.pdf' }))
      .body.data;
    const content = `Intro\n\n![diagram](${img.url})\n\n[Slides](${pdf.url}?download=1)\n`;
    const upd = await c.patch(`/api/notes/${n.id}`, { revision: 1, markdownContent: content });
    return { m, n: upd.body.data, img, pdf };
  }

  it('exports Markdown with front matter and no authenticated URLs', async () => {
    const { n } = await noteWithImage();
    const res = await c.get(`/api/export/notes/${n.id}/markdown`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/markdown/);
    expect(res.headers['content-disposition']).toContain('2025-02-03-waves-optics.md');
    expect(res.text).toMatch(
      /^---\ntitle: "Waves & Optics"\nlecture_date: 2025-02-03\nmodule: "Physics 101"/,
    );
    expect(res.text).not.toContain('/api/attachments');
    expect(res.text).toMatch(/!\[diagram\]\(assets\/[0-9a-f]{8}-diagram-1\.png\)/);
  });

  it('exports a note ZIP whose relative links resolve to included assets', async () => {
    const { n } = await noteWithImage();
    const res = await c.get(`/api/export/notes/${n.id}/zip`).buffer(true).parse(binaryParser);
    expect(res.headers['content-type']).toBe('application/zip');
    const files = await readZip(res.body as Buffer);
    const mdName = [...files.keys()].find((k) => k.endsWith('.md'))!;
    const md = files.get(mdName)!.toString();
    expect(md).not.toContain('/api/');
    const links = [...md.matchAll(/\]\((assets\/[^)]+)\)/g)].map((m) => m[1]!);
    expect(links).toHaveLength(2);
    const dir = mdName.slice(0, mdName.lastIndexOf('/') + 1);
    for (const l of links) expect(files.has(dir + l)).toBe(true);
    expect(
      files
        .get(dir + links[0]!)!
        .subarray(1, 4)
        .toString(),
    ).toBe('PNG');
  });

  it('exports a module ZIP', async () => {
    const { m } = await noteWithImage();
    await createNote(c, { title: 'Second', moduleId: m.id });
    const res = await c.get(`/api/export/modules/${m.id}/zip`).buffer(true).parse(binaryParser);
    const files = await readZip(res.body as Buffer);
    const md = [...files.keys()].filter((k) => k.endsWith('.md'));
    expect(md).toHaveLength(2);
    expect(md.every((k) => k.startsWith('phy101-physics-101/'))).toBe(true);
  });

  it('full export includes manifest, all notes, assets and versions', async () => {
    const { n } = await noteWithImage();
    await createNote(c, { title: 'Loose note' });
    const archived = await createNote(c, { title: 'Old' });
    await c.post(`/api/notes/${archived.id}/archive`);
    const deleted = await createNote(c, { title: 'Gone' });
    await c.delete(`/api/notes/${deleted.id}`);

    const res = await c.get('/api/export/all').buffer(true).parse(binaryParser);
    const files = await readZip(res.body as Buffer);
    const root = [...files.keys()][0]!.split('/')[0]!;
    const manifest = JSON.parse(files.get(`${root}/manifest.json`)!.toString());
    expect(manifest.format).toBe('uninotes-export');
    expect(manifest.notes).toHaveLength(3);
    expect(manifest.notes.map((x: { title: string }) => x.title).sort()).toEqual([
      'Loose note',
      'Old',
      'Waves & Optics',
    ]);
    expect(manifest.modules).toHaveLength(1);
    expect(manifest.attachments).toHaveLength(2);
    for (const note of manifest.notes) {
      const md = files.get(`${root}/${note.path}`)!.toString();
      for (const [, rel] of md.matchAll(/\]\((\.\.\/\.\.\/assets\/[^)]+)\)/g)) {
        const resolved = `${root}/${note.path
          .split('/')
          .slice(0, -1)
          .concat(rel!.split('/'))
          .reduce((acc: string[], part: string) => (part === '..' ? acc.slice(0, -1) : [...acc, part]), [])
          .join('/')}`;
        expect(files.has(resolved), resolved).toBe(true);
      }
    }
    expect(files.has(`${root}/versions/${n.id}.json`)).toBe(true);
  });
});
