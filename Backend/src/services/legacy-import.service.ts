import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import yauzl from 'yauzl';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { attachments } from '../db/schema.js';
import { newId } from '../lib/crypto.js';
import { dateOnly } from '../lib/route.js';
import {
  attachmentRow,
  attachmentUrl,
  prepareUpload,
  storagePath,
  writeStoredFile,
  type PreparedFile,
} from './attachments.service.js';
import { decodeMarkdown } from './import.service.js';
import { createModule, ModuleInputSchema } from './modules.service.js';
import { createNote } from './notes.service.js';
import { TagSchema } from './tags.service.js';

/**
 * Bulk import of a legacy Markdown notes archive (operator CLI only: scripts/import-legacy.ts).
 *
 * The archive is read into memory with strict safety checks and nothing in it is ever executed.
 * An explicit mapping file decides where every file goes; any archive file the mapping does not
 * account for is a blocking problem, so nothing is silently skipped. Each note (or group of notes
 * sharing images) is created in one transaction together with its attachments, reusing the
 * normal note and attachment code paths. Notes carry a source key derived from the original path
 * and checksum, so re-running never creates duplicates and never touches existing notes.
 */

// ---------- Mapping file ----------

const Transform = z.discriminatedUnion('type', [
  // Replace the exact text starting at `line` (`from` may span several lines).
  z.object({
    type: z.literal('replace-line'),
    line: z.number().int().min(1),
    from: z.string(),
    to: z.string(),
    reason: z.string(),
    pendingApproval: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('remove-chat-citations'),
    expectedCount: z.number().int().min(1),
    reason: z.string(),
    pendingApproval: z.boolean().optional(),
  }),
]);

export const LegacyMappingSchema = z.object({
  formatVersion: z.literal(1),
  description: z.string().optional(),
  archive: z.object({
    fileName: z.string(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    archiveRoot: z.string().regex(/^([^/]+\/)?$/),
  }),
  targetUsername: z.string().min(1),
  modules: z.record(
    z.string(),
    ModuleInputSchema.pick({ name: true, academicYear: true, color: true, description: true }),
  ),
  notes: z.array(
    z.object({
      source: z.string(),
      module: z.string().nullable(),
      title: z.string().trim().min(1).max(300),
      lectureDate: dateOnly.nullable(),
      tags: z.array(TagSchema).max(25),
      empty: z.boolean().optional(),
      nearDuplicateOf: z.string().optional(),
      dateCorrection: z
        .object({ filenameDate: z.string(), parsedAs: z.string(), correctedTo: dateOnly, reason: z.string() })
        .optional(),
      transforms: z.array(Transform).optional(),
      review: z.string().optional(),
    }),
  ),
  sourceNotes: z.array(
    z.object({
      module: z.string(),
      title: z.string().trim().min(1).max(300),
      tags: z.array(TagSchema).max(25),
      groups: z.array(
        z.object({
          heading: z.string(),
          folder: z.string(),
          relatedNotes: z.array(z.string()),
          files: z.array(z.string()).min(1),
        }),
      ),
    }),
  ),
  exclude: z.array(
    z.object({ path: z.string(), reason: z.enum(['repository-metadata', 'compiled-executable']) }),
  ),
});
export type LegacyMapping = z.infer<typeof LegacyMappingSchema>;

// ---------- Archive reading ----------

export const ARCHIVE_LIMITS = {
  maxEntries: 5000,
  maxTotalBytes: 200 * 1024 * 1024,
  maxEntryBytes: 50 * 1024 * 1024,
  // Highly compressible entries above 1 MB beyond this ratio are treated as decompression bombs.
  maxRatio: 200,
};

export interface ArchiveFile {
  path: string;
  data: Buffer;
  sha256: string;
}
export interface Archive {
  files: Map<string, ArchiveFile>;
  entries: number;
  directories: number;
}

export const sha256 = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest('hex');
export const sha256FileSync = (file: string) => sha256(fs.readFileSync(file));

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/**
 * Read every file of a ZIP archive into memory, relative to `root`. Rejects absolute paths, `..`
 * segments, backslashes, symlinks, encrypted entries, entries outside the root, oversized entries,
 * suspicious compression ratios and archives over the entry/byte limits. Declared sizes are
 * checked against the bytes actually inflated (yauzl validateEntrySizes).
 */
export function readArchive(zipPath: string, root: string, limits = ARCHIVE_LIMITS): Promise<Archive> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      zipPath,
      {
        lazyEntries: true,
        validateEntrySizes: true,
        strictFileNames: true,
        decodeStrings: true,
        autoClose: true,
      },
      (err, zip) => {
        if (err || !zip) return reject(err ?? new Error('Could not open archive'));
        const files = new Map<string, ArchiveFile>();
        let entries = 0;
        let directories = 0;
        let total = 0;
        let failed = false;
        const fail = (message: string) => {
          if (failed) return;
          failed = true;
          zip.close();
          reject(new Error(`Unsafe archive: ${message}`));
        };
        zip.on('error', (e: Error) => fail(e.message));
        zip.on('end', () => {
          if (!failed) resolve({ files, entries, directories });
        });
        zip.on('entry', (entry: yauzl.Entry) => {
          entries++;
          const name = entry.fileName;
          if (entries > limits.maxEntries) return fail(`more than ${limits.maxEntries} entries`);
          if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..'))
            return fail(`unsafe path ${JSON.stringify(name)}`);
          if (((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK) return fail(`symlink ${name}`);
          if (entry.isEncrypted()) return fail(`encrypted entry ${name}`);
          if (!name.startsWith(root)) return fail(`entry outside ${JSON.stringify(root)}: ${name}`);
          if (name.endsWith('/')) {
            directories++;
            return zip.readEntry();
          }
          const size = entry.uncompressedSize;
          if (size > limits.maxEntryBytes) return fail(`entry too large: ${name}`);
          total += size;
          if (total > limits.maxTotalBytes) return fail('archive expands beyond the size limit');
          if (size > 1024 * 1024 && size / Math.max(entry.compressedSize, 1) > limits.maxRatio)
            return fail(`suspicious compression ratio: ${name}`);
          zip.openReadStream(entry, (e, stream) => {
            if (e || !stream) return fail(e?.message ?? `cannot read ${name}`);
            const chunks: Buffer[] = [];
            let read = 0;
            stream.on('data', (c: Buffer) => {
              read += c.length;
              if (read > size) {
                stream.destroy();
                fail(`entry larger than declared: ${name}`);
              } else chunks.push(c);
            });
            stream.on('error', (se: Error) => fail(se.message));
            stream.on('end', () => {
              if (failed) return;
              const data = Buffer.concat(chunks);
              const rel = name.slice(root.length);
              files.set(rel, { path: rel, data, sha256: sha256(data) });
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    );
  });
}

// ---------- Markdown helpers ----------

/** Idempotency key for an original note: path + content, so identical files in different places stay distinct. */
export const legacySourceKey = (sourcePath: string, sourceSha256: string) =>
  sha256(`uninotes-legacy:v1\n${sourcePath}\n${sourceSha256}`);

export const generatedSourceKey = (title: string, files: { path: string; sha256: string }[]) =>
  sha256(`uninotes-legacy:v1:generated\n${title}\n${files.map((f) => `${f.path}:${f.sha256}`).join('\n')}`);

export interface ImageRef {
  index: number;
  length: number;
  alt: string;
  target: string;
  title: string | null;
}

const IMAGE_RE = /!\[([^\]\n]*)\]\(([^)\n]*)\)/g;

/** Inline Markdown images outside fenced code blocks. */
export function findImageRefs(markdown: string): ImageRef[] {
  const refs: ImageRef[] = [];
  let offset = 0;
  let fence: string | null = null;
  for (const line of markdown.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence ? null : marker;
    } else if (!fence) {
      for (const m of line.matchAll(IMAGE_RE)) {
        let inner = m[2]!.trim();
        let title: string | null = null;
        const t = /\s+("[^"]*"|'[^']*')$/.exec(inner);
        if (t) {
          title = t[1]!;
          inner = inner.slice(0, t.index).trim();
        }
        if (inner.startsWith('<') && inner.endsWith('>')) inner = inner.slice(1, -1);
        refs.push({ index: offset + m.index, length: m[0].length, alt: m[1]!, target: inner, title });
      }
    }
    offset += line.length + 1;
  }
  return refs;
}

export interface ResolvedImage {
  path: string | null;
  kind: 'relative' | 'root-relative' | 'external';
  remappedFrom?: string;
}

/**
 * Resolve an image reference against the note's folder. A root-relative "/Uni/<rest>" reference
 * from the old repository layout (which had no year folder) is accepted when exactly one
 * "Uni/<year folder>/<rest>" file exists in the archive.
 */
export function resolveImage(notePath: string, target: string, files: Set<string>): ResolvedImage {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return { path: null, kind: 'external' };
  let decoded = target;
  try {
    decoded = decodeURI(target);
  } catch {
    /* keep as written */
  }
  if (decoded.startsWith('/')) {
    const direct = path.posix.normalize(decoded.slice(1));
    if (files.has(direct)) return { path: direct, kind: 'root-relative' };
    const m = /^Uni\/(.+)$/.exec(direct);
    if (m) {
      const years = new Set([...files].filter((f) => f.startsWith('Uni/')).map((f) => f.split('/')[1]!));
      const hits = [...years].map((y) => `Uni/${y}/${m[1]}`).filter((p) => files.has(p));
      if (hits.length === 1) return { path: hits[0]!, kind: 'root-relative', remappedFrom: decoded };
    }
    return { path: null, kind: 'root-relative' };
  }
  const rel = path.posix.normalize(path.posix.join(path.posix.dirname(notePath), decoded));
  if (rel.startsWith('../') || rel === '..') return { path: null, kind: 'relative' };
  return { path: files.has(rel) ? rel : null, kind: 'relative' };
}

const CITATION_RE = /\s?cite(?:turn\d+search\d+)+/g;

export function applyTransforms(
  text: string,
  transforms: NonNullable<LegacyMapping['notes'][number]['transforms']>,
): { text: string; applied: Record<string, unknown>[]; problems: string[] } {
  const applied: Record<string, unknown>[] = [];
  const problems: string[] = [];
  let out = text;
  for (const t of transforms) {
    if (t.type === 'replace-line') {
      const lines = out.split('\n');
      const count = t.from.split('\n').length;
      if (lines.slice(t.line - 1, t.line - 1 + count).join('\n') !== t.from) {
        problems.push(`replace-line: line ${t.line} does not match the approved text`);
        continue;
      }
      lines.splice(t.line - 1, count, ...t.to.split('\n'));
      out = lines.join('\n');
      applied.push({
        type: t.type,
        line: t.line,
        from: t.from,
        to: t.to,
        reason: t.reason,
        ...(t.pendingApproval ? { pendingApproval: true } : {}),
      });
    } else {
      const lineNumbers: number[] = [];
      for (const m of out.matchAll(CITATION_RE)) lineNumbers.push(out.slice(0, m.index).split('\n').length);
      if (lineNumbers.length !== t.expectedCount) {
        problems.push(`remove-chat-citations: found ${lineNumbers.length}, expected ${t.expectedCount}`);
        continue;
      }
      const removed = [...out.matchAll(CITATION_RE)].map((m) => m[0]);
      out = out.replace(CITATION_RE, '');
      if (/[-]/.test(out)) problems.push('remove-chat-citations: stray marker characters remain');
      applied.push({
        type: t.type,
        count: removed.length,
        lines: lineNumbers,
        removed,
        reason: t.reason,
        ...(t.pendingApproval ? { pendingApproval: true } : {}),
      });
    }
  }
  return { text: out, applied, problems };
}

// ---------- Planning ----------

export interface PlannedImage {
  source: string;
  sha256: string;
  bytes: number;
  prepared: PreparedFile;
  originalSize: { width: number; height: number };
  referencedBy: string[];
  attachmentId: string | null;
  status: 'planned' | 'imported' | 'already-imported' | 'failed';
}

export interface PlannedNote {
  source: string;
  sha256: string;
  bytes: number;
  sourceKey: string;
  mapping: LegacyMapping['notes'][number];
  markdown: string;
  refs: (ImageRef & { resolved: ResolvedImage })[];
  transformations: Record<string, unknown>[];
  warnings: string[];
  status: 'planned' | 'imported' | 'already-imported' | 'failed';
  noteId: string | null;
}

export interface PlannedSourceFile {
  source: string;
  sha256: string;
  bytes: number;
  prepared: PreparedFile;
  generatedNote: string;
  attachmentId: string | null;
  status: 'planned' | 'imported' | 'already-imported' | 'failed';
}

export interface PlannedGeneratedNote {
  mapping: LegacyMapping['sourceNotes'][number];
  sourceKey: string;
  files: PlannedSourceFile[];
  status: 'planned' | 'imported' | 'already-imported' | 'failed';
  noteId: string | null;
}

export interface PlannedModule {
  key: string;
  input: LegacyMapping['modules'][string];
  action: 'create' | 'reuse';
  moduleId: string | null;
}

export interface ImportPlan {
  user: { id: string; username: string; displayName: string };
  modules: PlannedModule[];
  notes: PlannedNote[];
  /** Groups of note indexes that share images; each group is imported in one transaction. */
  units: number[][];
  images: Map<string, PlannedImage>;
  generated: PlannedGeneratedNote[];
  excluded: { source: string; sha256: string; bytes: number; reason: string }[];
  problems: string[];
  warnings: string[];
  /** Transformations proposed in the mapping but not yet approved; a real import refuses to run. */
  pendingApprovals: string[];
}

const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);

export function resolveUser(ctx: AppContext, username: string) {
  return ctx.db.get<{ id: string; username: string; display_name: string } | undefined>(
    sql`SELECT id, username, display_name FROM users WHERE username = ${username}`,
  );
}

const findNoteBySourceKey = (ctx: AppContext, userId: string, key: string) =>
  ctx.db.get<{ id: string; deleted_at: string | null } | undefined>(
    sql`SELECT id, deleted_at FROM notes WHERE user_id = ${userId} AND source_hash = ${key} LIMIT 1`,
  );

/** Build the full plan without writing anything (safe on a read-only database connection). */
export async function planImport(
  ctx: AppContext,
  mapping: LegacyMapping,
  archive: Archive,
  user: ImportPlan['user'],
): Promise<ImportPlan> {
  const problems: string[] = [];
  const warnings: string[] = [];
  const files = archive.files;
  const names = new Set(files.keys());
  const accounted = new Set<string>();
  const claim = (p: string, what: string) => {
    if (accounted.has(p)) problems.push(`${p} is mapped more than once (${what})`);
    accounted.add(p);
  };

  // Modules: reuse by name + academic year (case-insensitive, archived included); never modify.
  const existing = ctx.db.all<{ id: string; name: string; academic_year: string | null }>(
    sql`SELECT id, name, academic_year FROM modules WHERE user_id = ${user.id}`,
  );
  const modules: PlannedModule[] = Object.entries(mapping.modules).map(([key, input]) => {
    const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
    const same = existing.filter((m) => norm(m.name) === norm(input.name));
    const match = same.find((m) => norm(m.academic_year) === norm(input.academicYear));
    if (!match && same.length)
      problems.push(
        `Module conflict: "${input.name}" already exists with academic year ${same.map((m) => m.academic_year ?? 'none').join(', ')}`,
      );
    return { key, input, action: match ? 'reuse' : 'create', moduleId: match?.id ?? null };
  });

  // Original notes.
  const notes: PlannedNote[] = [];
  for (const m of mapping.notes) {
    claim(m.source, 'note');
    if (m.module !== null && !mapping.modules[m.module])
      problems.push(`${m.source}: unknown module ${m.module}`);
    const f = files.get(m.source);
    if (!f) {
      problems.push(`${m.source}: not found in the archive`);
      continue;
    }
    if (f.data.length > ctx.config.limits.importBytes)
      problems.push(`${m.source}: larger than the import limit`);
    let text: string;
    try {
      text = decodeMarkdown(f.data);
    } catch (e) {
      problems.push(`${m.source}: ${(e as Error).message}`);
      continue;
    }
    const warnings: string[] = [];
    let transformations: Record<string, unknown>[] = [];
    if (m.transforms?.length) {
      const r = applyTransforms(text, m.transforms);
      text = r.text;
      transformations = r.applied;
      for (const p of r.problems) problems.push(`${m.source}: ${p}`);
    }
    if (text.length > ctx.config.limits.maxMarkdownChars) problems.push(`${m.source}: too long`);
    if (m.empty && f.data.length !== 0) problems.push(`${m.source}: mapped as empty but has content`);
    const refs = findImageRefs(text).map((r) => ({
      ...r,
      resolved: resolveImage(m.source, r.target, names),
    }));
    for (const r of refs) {
      if (r.resolved.kind === 'external') warnings.push(`external image left unchanged: ${r.target}`);
      else if (!r.resolved.path) problems.push(`${m.source}: missing image ${r.target}`);
      else if (r.resolved.remappedFrom)
        warnings.push(`image path remapped: ${r.target} -> ${r.resolved.path}`);
    }
    const sourceKey = legacySourceKey(m.source, f.sha256);
    const found = findNoteBySourceKey(ctx, user.id, sourceKey);
    if (found?.deleted_at)
      warnings.push('previously imported note is in the recycle bin; it will not be re-created');
    notes.push({
      source: m.source,
      sha256: f.sha256,
      bytes: f.data.length,
      sourceKey,
      mapping: m,
      markdown: text,
      refs,
      transformations,
      warnings,
      status: found ? 'already-imported' : 'planned',
      noteId: found?.id ?? null,
    });
  }

  // Images: one attachment per unique source path, validated through the normal image pipeline.
  const images = new Map<string, PlannedImage>();
  const rejected = new Set<string>();
  for (const n of notes) {
    for (const r of n.refs) {
      const p = r.resolved.path;
      if (!p || rejected.has(p)) continue;
      const img = images.get(p);
      if (img) {
        if (!img.referencedBy.includes(n.source)) img.referencedBy.push(n.source);
        continue;
      }
      const f = files.get(p)!;
      try {
        const meta = await sharp(f.data).metadata();
        const prepared = await prepareUpload(ctx, { buffer: f.data, originalname: path.posix.basename(p) });
        if (prepared.kind !== 'image') throw new Error('not an image');
        images.set(p, {
          source: p,
          sha256: f.sha256,
          bytes: f.data.length,
          prepared,
          originalSize: { width: meta.width ?? 0, height: meta.height ?? 0 },
          referencedBy: [n.source],
          attachmentId: null,
          status: 'planned',
        });
      } catch (e) {
        problems.push(`${p}: image rejected (${(e as Error).message})`);
        rejected.add(p);
      }
      claim(p, 'image');
    }
  }

  // Notes that share an image are imported together so they can share the attachment.
  const parent = notes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const owner = new Map<string, number>();
  notes.forEach((n, i) => {
    for (const r of n.refs) {
      if (!r.resolved.path) continue;
      const o = owner.get(r.resolved.path);
      if (o === undefined) owner.set(r.resolved.path, i);
      else parent[find(i)] = find(o);
    }
  });
  const unitMap = new Map<number, number[]>();
  notes.forEach((_, i) => unitMap.set(find(i), [...(unitMap.get(find(i)) ?? []), i]));
  const units = [...unitMap.values()];
  for (const u of units) {
    const st = new Set(u.map((i) => notes[i]!.status));
    if (st.size > 1)
      warnings.push(
        `Partially imported group (${u.map((i) => notes[i]!.source).join(', ')}): missing notes get their own copies of shared images`,
      );
  }

  // Generated "Source files" notes: original bytes, validated as source text.
  const generated: PlannedGeneratedNote[] = [];
  for (const s of mapping.sourceNotes) {
    if (!mapping.modules[s.module]) problems.push(`${s.title}: unknown module ${s.module}`);
    const planned: PlannedSourceFile[] = [];
    for (const g of s.groups) {
      for (const p of g.files) {
        claim(p, 'source file');
        const f = files.get(p);
        if (!f) {
          problems.push(`${p}: not found in the archive`);
          continue;
        }
        try {
          const prepared = await prepareUpload(ctx, { buffer: f.data, originalname: path.posix.basename(p) });
          if (prepared.mimeType !== 'text/plain' || !prepared.data.equals(f.data))
            throw new Error('not source text');
          planned.push({
            source: p,
            sha256: f.sha256,
            bytes: f.data.length,
            prepared,
            generatedNote: s.title,
            attachmentId: null,
            status: 'planned',
          });
        } catch (e) {
          problems.push(`${p}: source file rejected (${(e as Error).message})`);
        }
      }
    }
    const sourceKey = generatedSourceKey(
      s.title,
      planned.map((f) => ({ path: f.source, sha256: f.sha256 })),
    );
    const found = findNoteBySourceKey(ctx, user.id, sourceKey);
    generated.push({
      mapping: s,
      sourceKey,
      files: planned,
      status: found ? 'already-imported' : 'planned',
      noteId: found?.id ?? null,
    });
  }

  // Exclusions are explicit and verified.
  const excluded: ImportPlan['excluded'] = [];
  for (const x of mapping.exclude) {
    claim(x.path, 'exclude');
    const f = files.get(x.path);
    if (!f) {
      problems.push(`${x.path}: excluded file not found in the archive`);
      continue;
    }
    if (x.reason === 'compiled-executable' && !f.data.subarray(0, 4).equals(ELF_MAGIC))
      problems.push(`${x.path}: listed as a compiled executable but is not an ELF binary`);
    excluded.push({ source: x.path, sha256: f.sha256, bytes: f.data.length, reason: x.reason });
  }

  for (const p of names) if (!accounted.has(p)) problems.push(`${p}: not accounted for by the mapping`);

  // Files belonging only to notes that already exist will not be imported again.
  const pendingSources = new Set(notes.filter((n) => n.status === 'planned').map((n) => n.source));
  for (const img of images.values())
    if (!img.referencedBy.some((s) => pendingSources.has(s))) img.status = 'already-imported';
  for (const g of generated)
    if (g.status === 'already-imported') for (const f of g.files) f.status = 'already-imported';

  const pendingApprovals = notes.flatMap((n) =>
    (n.mapping.transforms ?? [])
      .filter((t) => t.pendingApproval)
      .map((t) => `${n.source}: ${t.type} — ${t.reason}`),
  );
  return { user, modules, notes, units, images, generated, excluded, problems, warnings, pendingApprovals };
}

// ---------- Execution ----------

export function rewriteImages(markdown: string, refs: PlannedNote['refs'], ids: Map<string, string>) {
  let out = '';
  let pos = 0;
  for (const r of refs) {
    const id = r.resolved.path ? ids.get(r.resolved.path) : undefined;
    if (!id) continue;
    out += markdown.slice(pos, r.index);
    out += `![${r.alt}](${attachmentUrl(id)}${r.title ? ` ${r.title}` : ''})`;
    pos = r.index + r.length;
  }
  return out + markdown.slice(pos);
}

export function sourceNoteMarkdown(
  g: PlannedGeneratedNote,
  mapping: LegacyMapping,
  ids: Map<string, string>,
  titleOf: Map<string, string>,
) {
  const lines = [
    `# ${g.mapping.title}`,
    '',
    `> Generated during the legacy notes migration from \`${mapping.archive.fileName}\` (SHA-256 \`${mapping.archive.sha256.slice(0, 12)}…\`).`,
    '> The original source files are attached unchanged and can only be downloaded; nothing is executed.',
    '',
  ];
  for (const grp of g.mapping.groups) {
    lines.push(`## ${grp.heading}`, '', `Original folder: \`${grp.folder}\``);
    const related = grp.relatedNotes.map((p) => titleOf.get(p) ?? p);
    if (related.length) lines.push('', `Related notes: ${related.map((t) => `*${t}*`).join(', ')}`);
    lines.push('');
    for (const p of grp.files) {
      const id = ids.get(p);
      const name = path.posix.basename(p).replace(/[[\]]/g, '');
      lines.push(id ? `- [📎 ${name}](${attachmentUrl(id)}?download=1) — \`${p}\`` : `- ${name} — \`${p}\``);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export interface ExecuteResult {
  failed: { what: string; error: string } | null;
}

/**
 * Write the plan. Stops at the first failure; everything committed before it stays consistent
 * (each unit is atomic) and a re-run continues where it stopped.
 */
export function executeImport(ctx: AppContext, mapping: LegacyMapping, plan: ImportPlan): ExecuteResult {
  if (plan.problems.length) throw new Error('Refusing to import a plan with blocking problems');
  if (plan.pendingApprovals.length)
    throw new Error('Refusing to import: transformations are pending approval');
  const userId = plan.user.id;
  const moduleIds = new Map<string, string>();
  // Modules first (single-row inserts); a module left empty by a later failure is reused on re-run.
  for (const m of plan.modules) {
    if (m.action === 'reuse') moduleIds.set(m.key, m.moduleId!);
    else {
      const created = createModule(ctx.db, userId, { code: null, ...m.input });
      m.moduleId = created.id;
      moduleIds.set(m.key, created.id);
    }
  }

  const writeFiles = (items: { prepared: PreparedFile }[]) =>
    items.map((i) => writeStoredFile(ctx, i.prepared.data));
  const removeFiles = (keys: string[]) =>
    keys.forEach((k) => fs.rmSync(storagePath(ctx, k), { force: true }));

  for (const unit of plan.units) {
    const todo = unit.map((i) => plan.notes[i]!).filter((n) => n.status === 'planned');
    if (!todo.length) {
      for (const i of unit)
        for (const r of plan.notes[i]!.refs)
          if (r.resolved.path) plan.images.get(r.resolved.path)!.status = 'already-imported';
      continue;
    }
    const imgs = [
      ...new Set(todo.flatMap((n) => n.refs.map((r) => r.resolved.path).filter((p): p is string => !!p))),
    ].map((p) => plan.images.get(p)!);
    const ids = new Map(imgs.map((img) => [img.source, newId()]));
    const keys = writeFiles(imgs);
    try {
      ctx.db.transaction((tx) => {
        const noteIdBySource = new Map<string, string>();
        for (const n of todo) {
          const note = createNote(tx, userId, {
            title: n.mapping.title,
            markdownContent: rewriteImages(n.markdown, n.refs, ids),
            moduleId: n.mapping.module ? moduleIds.get(n.mapping.module)! : null,
            lectureDate: n.mapping.lectureDate,
            tags: n.mapping.tags,
            isFavourite: false,
            sourceHash: n.sourceKey,
            versionReason: 'import',
          });
          noteIdBySource.set(n.source, note.id);
          n.noteId = note.id;
        }
        imgs.forEach((img, k) => {
          const host = img.referencedBy.find((s) => noteIdBySource.has(s))!;
          tx.insert(attachments)
            .values(
              attachmentRow(userId, noteIdBySource.get(host)!, img.prepared, keys[k]!, ids.get(img.source)!),
            )
            .run();
          img.attachmentId = ids.get(img.source)!;
        });
      });
      for (const n of todo) n.status = 'imported';
      for (const img of imgs) img.status = 'imported';
    } catch (e) {
      removeFiles(keys);
      for (const n of todo) {
        n.status = 'failed';
        n.noteId = null;
      }
      for (const img of imgs) {
        img.status = 'failed';
        img.attachmentId = null;
      }
      return { failed: { what: todo.map((n) => n.source).join(', '), error: (e as Error).message } };
    }
  }

  const titleOf = new Map(plan.notes.map((n) => [n.source, n.mapping.title]));
  for (const g of plan.generated) {
    if (g.status !== 'planned') {
      for (const f of g.files) f.status = 'already-imported';
      continue;
    }
    const ids = new Map(g.files.map((f) => [f.source, newId()]));
    const keys = writeFiles(g.files);
    try {
      ctx.db.transaction((tx) => {
        const note = createNote(tx, userId, {
          title: g.mapping.title,
          markdownContent: sourceNoteMarkdown(g, mapping, ids, titleOf),
          moduleId: moduleIds.get(g.mapping.module)!,
          lectureDate: null,
          tags: g.mapping.tags,
          isFavourite: false,
          sourceHash: g.sourceKey,
          versionReason: 'import',
        });
        g.noteId = note.id;
        g.files.forEach((f, k) => {
          tx.insert(attachments)
            .values(attachmentRow(userId, note.id, f.prepared, keys[k]!, ids.get(f.source)!))
            .run();
          f.attachmentId = ids.get(f.source)!;
        });
      });
      g.status = 'imported';
      for (const f of g.files) f.status = 'imported';
    } catch (e) {
      removeFiles(keys);
      g.status = 'failed';
      g.noteId = null;
      for (const f of g.files) {
        f.status = 'failed';
        f.attachmentId = null;
      }
      return { failed: { what: g.mapping.title, error: (e as Error).message } };
    }
  }
  return { failed: null };
}

// ---------- Manifest ----------

export function buildManifest(
  plan: ImportPlan,
  mapping: LegacyMapping,
  info: {
    mode: 'dry-run' | 'import';
    zipPath: string;
    sha256Before: string;
    sha256After: string;
    mappingPath: string;
    mappingSha256: string;
    entries: number;
    directories: number;
    failed?: ExecuteResult['failed'];
  },
) {
  const moduleIds = new Map(plan.modules.map((m) => [m.key, m.moduleId]));
  const count = <T extends { status: string }>(xs: T[]) =>
    xs.reduce<Record<string, number>>((acc, x) => ({ ...acc, [x.status]: (acc[x.status] ?? 0) + 1 }), {});
  const images = [...plan.images.values()];
  const sourceFiles = plan.generated.flatMap((g) => g.files);
  const allNotes = [...plan.notes, ...plan.generated];
  return {
    format: 'uninotes-legacy-import-manifest',
    formatVersion: 1,
    mode: info.mode,
    generatedAt: new Date().toISOString(),
    archive: {
      path: info.zipPath,
      expectedSha256: mapping.archive.sha256,
      sha256Before: info.sha256Before,
      sha256After: info.sha256After,
      unchanged: info.sha256Before === info.sha256After,
      entries: info.entries,
      directories: info.directories,
      files: plan.notes.length + images.length + sourceFiles.length + plan.excluded.length,
    },
    mapping: { path: info.mappingPath, sha256: info.mappingSha256 },
    target: { username: plan.user.username, displayName: plan.user.displayName, userId: plan.user.id },
    summary: {
      modules: {
        create: plan.modules.filter((m) => m.action === 'create').length,
        reuse: plan.modules.filter((m) => m.action === 'reuse').length,
      },
      originalNotes: { total: plan.notes.length, ...count(plan.notes) },
      generatedNotes: { total: plan.generated.length, ...count(plan.generated) },
      newNotesWithoutLectureDate:
        plan.notes.filter((n) => n.status !== 'already-imported' && n.mapping.lectureDate === null).length +
        plan.generated.filter((g) => g.status !== 'already-imported').length,
      originalNotesWithoutLectureDate: plan.notes.filter((n) => n.mapping.lectureDate === null).length,
      correctedLectureDates: plan.notes.filter((n) => n.mapping.dateCorrection).length,
      emptyNotes: plan.notes.filter((n) => n.mapping.empty).length,
      notesWithTransformations: plan.notes.filter((n) => n.transformations.length).length,
      images: { total: images.length, ...count(images) },
      imageReferences: plan.notes.reduce((a, n) => a + n.refs.length, 0),
      resizedImages: images.filter(
        (i) => i.prepared.width !== i.originalSize.width || i.prepared.height !== i.originalSize.height,
      ).length,
      sourceFiles: { total: sourceFiles.length, ...count(sourceFiles) },
      excluded: plan.excluded.reduce<Record<string, number>>(
        (a, x) => ({ ...a, [x.reason]: (a[x.reason] ?? 0) + 1 }),
        {},
      ),
      totalNewNotes: allNotes.filter((n) => n.status !== 'already-imported').length,
      problems: plan.problems.length,
      warnings: plan.warnings.length + plan.notes.reduce((a, n) => a + n.warnings.length, 0),
    },
    modules: plan.modules.map((m) => ({
      key: m.key,
      name: m.input.name,
      academicYear: m.input.academicYear,
      action: m.action,
      moduleId: m.moduleId,
    })),
    notes: plan.notes.map((n) => ({
      source: n.source,
      sourceSha256: n.sha256,
      bytes: n.bytes,
      status: n.status,
      targetUserId: plan.user.id,
      module: n.mapping.module ? mapping.modules[n.mapping.module]!.name : null,
      moduleId: n.mapping.module ? (moduleIds.get(n.mapping.module) ?? null) : null,
      noteId: n.noteId,
      title: n.mapping.title,
      lectureDate: n.mapping.lectureDate,
      ...(n.mapping.dateCorrection ? { dateCorrection: n.mapping.dateCorrection } : {}),
      tags: n.mapping.tags,
      ...(n.mapping.empty ? { empty: true } : {}),
      ...(n.mapping.nearDuplicateOf ? { nearDuplicateOf: n.mapping.nearDuplicateOf } : {}),
      images: n.refs.map((r) => ({
        target: r.target,
        resolvedSource: r.resolved.path,
        ...(r.resolved.remappedFrom ? { remappedFrom: r.resolved.remappedFrom } : {}),
        attachmentId: r.resolved.path ? (plan.images.get(r.resolved.path)?.attachmentId ?? null) : null,
      })),
      attachmentIds: [
        ...new Set(
          n.refs
            .map((r) => (r.resolved.path ? plan.images.get(r.resolved.path)?.attachmentId : null))
            .filter(Boolean),
        ),
      ],
      transformations: n.transformations,
      warnings: n.warnings,
      ...(n.mapping.review ? { review: n.mapping.review } : {}),
    })),
    generatedNotes: plan.generated.map((g) => ({
      title: g.mapping.title,
      status: g.status,
      targetUserId: plan.user.id,
      module: mapping.modules[g.mapping.module]!.name,
      moduleId: moduleIds.get(g.mapping.module) ?? null,
      noteId: g.noteId,
      lectureDate: null,
      tags: g.mapping.tags,
      groups: g.mapping.groups.map((grp) => ({ heading: grp.heading, folder: grp.folder, files: grp.files })),
      attachmentIds: g.files.map((f) => f.attachmentId).filter(Boolean),
    })),
    images: images.map((i) => ({
      source: i.source,
      sourceSha256: i.sha256,
      bytes: i.bytes,
      status: i.status,
      attachmentId: i.attachmentId,
      referencedBy: i.referencedBy,
      originalSize: i.originalSize,
      storedSize: { width: i.prepared.width, height: i.prepared.height },
      storedBytes: i.prepared.data.length,
      storedSha256: sha256(i.prepared.data),
      transformation:
        i.prepared.width !== i.originalSize.width
          ? 'downscaled to fit 4096 px and re-encoded (metadata stripped)'
          : 're-encoded losslessly (metadata stripped)',
    })),
    sourceFiles: sourceFiles.map((f) => ({
      source: f.source,
      sourceSha256: f.sha256,
      bytes: f.bytes,
      status: f.status,
      attachmentId: f.attachmentId,
      storedByteForByte: f.prepared.data.length === f.bytes && sha256(f.prepared.data) === f.sha256,
      generatedNote: f.generatedNote,
    })),
    excluded: plan.excluded.map((x) => ({ ...x, status: 'excluded' })),
    failure: info.failed ?? null,
    pendingApprovals: plan.pendingApprovals,
    problems: plan.problems,
    warnings: plan.warnings,
  };
}
export type ImportManifest = ReturnType<typeof buildManifest>;
