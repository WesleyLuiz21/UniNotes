import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import sharp from 'sharp';
import yazl from 'yazl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createContext } from '../src/context.js';
import type { DB } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { createLogger } from '../src/logger.js';
import {
  applyTransforms,
  executeImport,
  findImageRefs,
  legacySourceKey,
  LegacyMappingSchema,
  planImport,
  readArchive,
  resolveImage,
  sha256,
  type LegacyMapping,
} from '../src/services/legacy-import.service.js';
import { Client, createModule, createNote, createTestEnv, loggedInClient, type TestEnv } from './helpers.js';
import { PNG_1x1 } from './fixtures.js';
import { binaryParser } from './zip.js';

const ROOT = 'Arc/';
const ELF = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), Buffer.alloc(64, 0)]);
const C_SRC = Buffer.from('#include <stdio.h>\nint main(void) { return 0; }\n');
const PNG_RED = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ff0000' } })
  .png()
  .toBuffer();

function zipBuffer(entries: { name: string; data?: Buffer; mode?: number }[]): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const e of entries) {
    if (e.data === undefined) zip.addEmptyDirectory(e.name);
    else zip.addBuffer(e.data, e.name, e.mode ? { mode: e.mode } : {});
  }
  zip.end();
  const chunks: Buffer[] = [];
  return new Promise((resolve) => {
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

let env: TestEnv;
let c: Client;
let userId: string;
beforeEach(async () => {
  env = createTestEnv();
  c = await loggedInClient(env, 'switchback');
  userId = (
    env.ctx.db.$client.prepare("SELECT id FROM users WHERE username = 'switchback'").get() as { id: string }
  ).id;
});
afterEach(() => env.cleanup());

const writeZip = async (entries: Parameters<typeof zipBuffer>[0]) => {
  const file = path.join(env.dir, `a-${Math.random().toString(36).slice(2)}.zip`);
  fs.writeFileSync(file, await zipBuffer(entries));
  return file;
};

/** A small archive exercising repeated names, shared and root-relative images, code and exclusions. */
const FIXTURE = () => [
  { name: 'Arc/' },
  {
    name: 'Arc/Uni/Year0 /A/note1.md',
    data: Buffer.from('# One\n\n![shot](image.png)\n\n![old](/Uni/res/pic.png)\n'),
  },
  { name: 'Arc/Uni/Year0 /A/image.png', data: PNG_1x1 },
  { name: 'Arc/Uni/Year0 /res/pic.png', data: PNG_1x1 },
  {
    name: 'Arc/Uni/Year0 /B/note2.md',
    data: Buffer.from('# Two\n\n![b](image.png )\n\n```md\n![not an image](nope.png)\n```\n'),
  },
  { name: 'Arc/Uni/Year0 /B/note3.md', data: Buffer.from('Shared: ![again](image.png)') },
  { name: 'Arc/Uni/Year0 /B/image.png', data: PNG_RED },
  { name: 'Arc/Uni/Year0 /B/empty.md', data: Buffer.alloc(0) },
  { name: 'Arc/Uni/Year0 /B/ex.c', data: C_SRC },
  { name: 'Arc/Uni/Year0 /B/ex', data: ELF },
  { name: 'Arc/package.json', data: Buffer.from('{}') },
];

const mappingFor = (zipSha: string, overrides: Partial<LegacyMapping> = {}): LegacyMapping =>
  LegacyMappingSchema.parse({
    formatVersion: 1,
    archive: { fileName: 'a.zip', sha256: zipSha, archiveRoot: ROOT },
    targetUsername: 'switchback',
    modules: {
      A: { name: 'Algorithms', academicYear: '2025/26', color: '#3B82F6', description: 'existing' },
      N: { name: 'New Module', academicYear: '2023/24', color: '#10B981', description: 'Imported' },
    },
    notes: [
      {
        source: 'Uni/Year0 /A/note1.md',
        module: 'N',
        title: 'One',
        lectureDate: '2023-10-17',
        tags: ['legacy-import'],
      },
      {
        source: 'Uni/Year0 /B/note2.md',
        module: 'N',
        title: 'Two',
        lectureDate: null,
        tags: ['legacy-import'],
      },
      {
        source: 'Uni/Year0 /B/note3.md',
        module: 'A',
        title: 'Three',
        lectureDate: null,
        tags: ['legacy-import'],
      },
      {
        source: 'Uni/Year0 /B/empty.md',
        module: null,
        title: 'empty',
        lectureDate: null,
        tags: ['legacy-import', 'legacy-empty'],
        empty: true,
      },
    ],
    sourceNotes: [
      {
        module: 'N',
        title: 'New Module — Source files',
        tags: ['legacy-import', 'source-files'],
        groups: [
          {
            heading: 'B',
            folder: 'Uni/Year0 /B',
            relatedNotes: ['Uni/Year0 /B/note2.md'],
            files: ['Uni/Year0 /B/ex.c'],
          },
        ],
      },
    ],
    exclude: [
      { path: 'Uni/Year0 /B/ex', reason: 'compiled-executable' },
      { path: 'package.json', reason: 'repository-metadata' },
    ],
    ...overrides,
  });

const counts = () =>
  Object.fromEntries(
    ['modules', 'notes', 'attachments', 'note_versions', 'notes_fts', 'tags'].map((t) => [
      t,
      (env.ctx.db.$client.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n,
    ]),
  );

async function prepare(entries = FIXTURE(), overrides: Partial<LegacyMapping> = {}) {
  const file = await writeZip(entries);
  const mapping = mappingFor(sha256(fs.readFileSync(file)), overrides);
  const archive = await readArchive(file, ROOT);
  const user = { id: userId, username: 'switchback', displayName: 'switchback' };
  return { file, mapping, archive, user };
}

describe('archive safety', () => {
  it('reads files relative to the root', async () => {
    const { archive } = await prepare();
    expect(archive.files.size).toBe(10);
    expect(archive.files.get('Uni/Year0 /B/ex.c')!.data.equals(C_SRC)).toBe(true);
  });

  it('rejects path traversal', async () => {
    // yazl refuses unsafe names, so write a safe one and patch it to ".." in the raw bytes.
    const buf = await zipBuffer([{ name: 'Arc/xx/evil.md', data: Buffer.from('x') }]);
    const patched = Buffer.from(buf.toString('latin1').replaceAll('Arc/xx/', 'Arc/../'), 'latin1');
    const file = path.join(env.dir, 'trav.zip');
    fs.writeFileSync(file, patched);
    await expect(readArchive(file, ROOT)).rejects.toThrow(/relative path|unsafe/i);
  });

  it('rejects symlinks', async () => {
    const file = await writeZip([{ name: 'Arc/link', data: Buffer.from('/etc/passwd'), mode: 0o120777 }]);
    await expect(readArchive(file, ROOT)).rejects.toThrow(/symlink/);
  });

  it('rejects entries outside the archive root', async () => {
    const file = await writeZip([{ name: 'Other/a.md', data: Buffer.from('x') }]);
    await expect(readArchive(file, ROOT)).rejects.toThrow(/outside/);
  });

  it('rejects decompression bombs and enforces limits', async () => {
    const bomb = await writeZip([{ name: 'Arc/zeros.md', data: Buffer.alloc(5 * 1024 * 1024) }]);
    await expect(readArchive(bomb, ROOT)).rejects.toThrow(/compression ratio/);
    const many = await writeZip([1, 2, 3].map((i) => ({ name: `Arc/${i}.md`, data: Buffer.from('x') })));
    await expect(
      readArchive(many, ROOT, { maxEntries: 2, maxTotalBytes: 1e9, maxEntryBytes: 1e9, maxRatio: 200 }),
    ).rejects.toThrow(/entries/);
    const big = await writeZip([{ name: 'Arc/a.md', data: Buffer.from('0123456789') }]);
    await expect(
      readArchive(big, ROOT, { maxEntries: 9, maxTotalBytes: 1e9, maxEntryBytes: 5, maxRatio: 200 }),
    ).rejects.toThrow(/too large/);
  });
});

describe('Markdown helpers', () => {
  const files = new Set(['Uni/Year0 /A/image.png', 'Uni/Year0 /B/image.png', 'Uni/Year0 /res/pic.png']);

  it('resolves repeated file names by folder and remaps old root-relative paths', () => {
    expect(resolveImage('Uni/Year0 /A/n.md', 'image.png', files).path).toBe('Uni/Year0 /A/image.png');
    expect(resolveImage('Uni/Year0 /B/n.md', 'image.png', files).path).toBe('Uni/Year0 /B/image.png');
    expect(resolveImage('Uni/Year0 /A/n.md', '/Uni/res/pic.png', files)).toEqual({
      path: 'Uni/Year0 /res/pic.png',
      kind: 'root-relative',
      remappedFrom: '/Uni/res/pic.png',
    });
    expect(resolveImage('Uni/Year0 /A/n.md', '../../../../etc/passwd', files).path).toBeNull();
    expect(resolveImage('Uni/Year0 /A/n.md', 'https://x/y.png', files).kind).toBe('external');
  });

  it('refuses an ambiguous root-relative remap', () => {
    const two = new Set(['Uni/Year0 /res/pic.png', 'Uni/Year 1/res/pic.png']);
    expect(resolveImage('Uni/Year0 /A/n.md', '/Uni/res/pic.png', two).path).toBeNull();
  });

  it('finds images outside code blocks only and tolerates trailing spaces', () => {
    const md = '![a](x.png )\n```\n![b](y.png)\n```\n~~~\n![c](z.png)\n~~~\n![d](<w.png> "t")';
    expect(findImageRefs(md).map((r) => [r.alt, r.target, r.title])).toEqual([
      ['a', 'x.png', null],
      ['d', 'w.png', '"t"'],
    ]);
  });

  it('applies approved transformations exactly, or reports a problem', () => {
    const ok = applyTransforms('<h1>T</h1>\nbody', [
      { type: 'replace-line', line: 1, from: '<h1>T</h1>', to: '# T', reason: 'r' },
    ]);
    expect(ok.text).toBe('# T\nbody');
    const bad = applyTransforms('changed\nbody', [
      { type: 'replace-line', line: 1, from: '<h1>T</h1>', to: '# T', reason: 'r' },
    ]);
    expect(bad.problems).toHaveLength(1);
    expect(bad.text).toBe('changed\nbody');
    const multi = applyTransforms('a\n![\n  \n](x.png)\nb', [
      { type: 'replace-line', line: 2, from: '![\n  \n](x.png)', to: '![](x.png)', reason: 'r' },
    ]);
    expect(multi.text).toBe('a\n![](x.png)\nb');
    const cite = 'Use Vite. citeturn0search1turn0search6\nNext citeturn0search0 end';
    const r = applyTransforms(cite, [{ type: 'remove-chat-citations', expectedCount: 2, reason: 'r' }]);
    expect(r.text).toBe('Use Vite.\nNext end');
    expect(r.applied[0]).toMatchObject({ count: 2, lines: [1, 2] });
    expect(
      applyTransforms(cite, [{ type: 'remove-chat-citations', expectedCount: 7, reason: 'r' }]).problems,
    ).toHaveLength(1);
  });
});

describe('legacy import', () => {
  it('dry run plans everything on a read-only connection without writing', async () => {
    await createModule(c, { name: 'Algorithms', academicYear: '2025/26' });
    const { mapping, archive, user } = await prepare();
    const before = counts();
    const ro = new Database(env.ctx.config.paths.database, { readonly: true });
    const roCtx = createContext(env.ctx.config, drizzle(ro, { schema }) as DB, createLogger('silent'));
    const plan = await planImport(roCtx, mapping, archive, user);
    ro.close();
    expect(plan.problems).toEqual([]);
    expect(plan.modules.map((m) => [m.key, m.action])).toEqual([
      ['A', 'reuse'],
      ['N', 'create'],
    ]);
    expect(plan.notes.every((n) => n.status === 'planned')).toBe(true);
    expect(plan.images.size).toBe(3);
    expect(plan.images.get('Uni/Year0 /B/image.png')!.referencedBy).toEqual([
      'Uni/Year0 /B/note2.md',
      'Uni/Year0 /B/note3.md',
    ]);
    expect(plan.units.map((u) => u.length).sort()).toEqual([1, 1, 2]);
    expect(plan.excluded.map((x) => x.reason).sort()).toEqual(['compiled-executable', 'repository-metadata']);
    expect(counts()).toEqual(before);
    expect(fs.readdirSync(env.ctx.config.paths.attachments)).toHaveLength(0);
  });

  it('imports notes, images and source files for the user, then re-runs without duplicates', async () => {
    const existingModule = await createModule(c, { name: 'Algorithms', academicYear: '2025/26' });
    await createNote(c, { title: 'My own note', markdownContent: 'untouched' });
    const { mapping, archive, user } = await prepare();
    const plan = await planImport(env.ctx, mapping, archive, user);
    expect(executeImport(env.ctx, mapping, plan).failed).toBeNull();

    const notes = env.ctx.db.$client
      .prepare('SELECT id, user_id, module_id, title, lecture_date, markdown_content, source_hash FROM notes')
      .all() as {
      id: string;
      user_id: string;
      module_id: string | null;
      title: string;
      lecture_date: string | null;
      markdown_content: string;
      source_hash: string | null;
    }[];
    expect(notes).toHaveLength(6); // own note + 4 originals + 1 generated
    expect(new Set(notes.map((n) => n.user_id))).toEqual(new Set([userId]));
    const byTitle = new Map(notes.map((n) => [n.title, n]));
    expect(byTitle.get('My own note')!.markdown_content).toBe('untouched');
    expect(byTitle.get('Three')!.module_id).toBe(existingModule.id);
    expect(byTitle.get('One')!.lecture_date).toBe('2023-10-17');
    expect(byTitle.get('Two')!.lecture_date).toBeNull();
    expect(byTitle.get('empty')!.markdown_content).toBe('');
    expect(byTitle.get('empty')!.module_id).toBeNull();
    expect(byTitle.get('One')!.source_hash).toBe(
      legacySourceKey('Uni/Year0 /A/note1.md', archive.files.get('Uni/Year0 /A/note1.md')!.sha256),
    );

    // Image references are rewritten to the user's private attachments, and they load.
    const one = byTitle.get('One')!.markdown_content;
    expect(one).toMatch(
      /^# One\n\n!\[shot\]\(\/api\/attachments\/[0-9a-f-]{36}\/content\)\n\n!\[old\]\(\/api\/attachments\/[0-9a-f-]{36}\/content\)\n$/,
    );
    const shared = /\(\/api\/attachments\/([0-9a-f-]{36})\/content\)/.exec(
      byTitle.get('Two')!.markdown_content,
    )![1];
    expect(byTitle.get('Three')!.markdown_content).toBe(
      `Shared: ![again](/api/attachments/${shared}/content)`,
    );
    expect(byTitle.get('Two')!.markdown_content).toContain('```md\n![not an image](nope.png)\n```');
    for (const id of [...one.matchAll(/attachments\/([0-9a-f-]{36})/g)].map((m) => m[1]).concat(shared!)) {
      const res = await c.get(`/api/attachments/${id}/content`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
    }

    // The source file is stored byte-for-byte and linked from the generated note.
    const gen = byTitle.get('New Module — Source files')!;
    expect(gen.lecture_date).toBeNull();
    const srcId =
      /\[📎 ex\.c\]\(\/api\/attachments\/([0-9a-f-]{36})\/content\?download=1\) — `Uni\/Year0 \/B\/ex\.c`/.exec(
        gen.markdown_content,
      )![1]!;
    expect(gen.markdown_content).toContain('Related notes: *Two*');
    const dl = await c.get(`/api/attachments/${srcId}/content?download=1`).buffer(true).parse(binaryParser);
    expect((dl.body as Buffer).equals(C_SRC)).toBe(true);
    expect(dl.headers['content-disposition']).toMatch(/^attachment/);

    expect(counts()).toMatchObject({ modules: 2, notes: 6, attachments: 4, notes_fts: 6 });
    const search = await c.get('/api/search?q=shared');
    expect(search.body.data.map((n: { title: string }) => n.title)).toEqual(['Three']);
    const tags = await c.get(`/api/notes/${byTitle.get('empty')!.id}`);
    expect(tags.body.data.tags).toEqual(['legacy-empty', 'legacy-import']);

    // Re-run: everything is detected as already imported and nothing changes.
    const after = counts();
    const files = fs.readdirSync(env.ctx.config.paths.attachments).sort();
    const again = await planImport(env.ctx, mapping, archive, user);
    expect(again.problems).toEqual([]);
    expect(again.modules.every((m) => m.action === 'reuse')).toBe(true);
    expect([...again.notes, ...again.generated].every((n) => n.status === 'already-imported')).toBe(true);
    expect([...again.images.values()].every((i) => i.status === 'already-imported')).toBe(true);
    expect(again.generated.flatMap((g) => g.files).every((f) => f.status === 'already-imported')).toBe(true);
    expect(executeImport(env.ctx, mapping, again).failed).toBeNull();
    expect(counts()).toEqual(after);
    expect(fs.readdirSync(env.ctx.config.paths.attachments).sort()).toEqual(files);

    // A note the user moved to the recycle bin is not brought back.
    await c.delete(`/api/notes/${byTitle.get('One')!.id}`);
    const third = await planImport(env.ctx, mapping, archive, user);
    expect(third.notes[0]!.status).toBe('already-imported');
    expect(third.notes[0]!.warnings).toContainEqual(expect.stringMatching(/recycle bin/));
  });

  it('rolls back a failing unit, removes its files and reports the failure', async () => {
    const { mapping, archive, user } = await prepare();
    const plan = await planImport(env.ctx, mapping, archive, user);
    // Point module N at a module id that does not exist: the first note insert violates its FK.
    const n = plan.modules.find((m) => m.key === 'N')!;
    n.action = 'reuse';
    n.moduleId = '00000000-0000-4000-8000-000000000000';
    const result = executeImport(env.ctx, mapping, plan);
    expect(result.failed?.error).toMatch(/FOREIGN KEY/);
    expect(counts()).toMatchObject({ notes: 0, attachments: 0 });
    expect(fs.readdirSync(env.ctx.config.paths.attachments)).toHaveLength(0);
    expect(env.ctx.db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('blocks on unaccounted files, missing images, wrong exclusions and module conflicts', async () => {
    await createModule(c, { name: 'New Module', academicYear: '2026/27' });
    const entries = FIXTURE()
      .filter((e) => e.name !== 'Arc/Uni/Year0 /res/pic.png')
      .map((e) => (e.name === 'Arc/Uni/Year0 /B/ex' ? { ...e, data: Buffer.from('not elf') } : e))
      .concat([{ name: 'Arc/stray.txt', data: Buffer.from('?') }]);
    const { mapping, archive, user } = await prepare(entries);
    const plan = await planImport(env.ctx, mapping, archive, user);
    expect(plan.problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Module conflict: "New Module"/),
        'Uni/Year0 /A/note1.md: missing image /Uni/res/pic.png',
        'Uni/Year0 /B/ex: listed as a compiled executable but is not an ELF binary',
        'stray.txt: not accounted for by the mapping',
      ]),
    );
  });

  it('refuses a real import while a transformation is pending approval', async () => {
    const entries = FIXTURE().map((e) =>
      e.name === 'Arc/Uni/Year0 /B/note3.md' ? { ...e, data: Buffer.from('![\n  \n](image.png)') } : e,
    );
    const base = await prepare(entries);
    const notes = base.mapping.notes.map((n) =>
      n.source === 'Uni/Year0 /B/note3.md'
        ? {
            ...n,
            transforms: [
              {
                type: 'replace-line' as const,
                line: 1,
                from: '![\n  \n](image.png)',
                to: '![](image.png)',
                reason: 'repair',
                pendingApproval: true,
              },
            ],
          }
        : n,
    );
    const mapping = LegacyMappingSchema.parse({ ...base.mapping, notes });
    const plan = await planImport(env.ctx, mapping, base.archive, base.user);
    expect(plan.problems).toEqual([]);
    expect(plan.pendingApprovals).toEqual(['Uni/Year0 /B/note3.md: replace-line — repair']);
    expect(plan.notes[2]!.refs.map((r) => r.target)).toEqual(['image.png']);
    expect(() => executeImport(env.ctx, mapping, plan)).toThrow(/pending approval/);
    expect(counts()).toMatchObject({ notes: 0, attachments: 0 });
  });

  it('rejects a source file that is really a binary', async () => {
    const entries = FIXTURE().map((e) => (e.name === 'Arc/Uni/Year0 /B/ex.c' ? { ...e, data: ELF } : e));
    const { mapping, archive, user } = await prepare(entries);
    const plan = await planImport(env.ctx, mapping, archive, user);
    expect(plan.problems).toEqual([expect.stringMatching(/^Uni\/Year0 \/B\/ex\.c: source file rejected/)]);
    expect(() => executeImport(env.ctx, mapping, plan)).toThrow(/blocking problems/);
  });
});
