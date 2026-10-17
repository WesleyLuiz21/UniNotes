import fs from 'node:fs';
import type { Response } from 'express';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import yazl from 'yazl';
import type { AppContext } from '../context.js';
import {
  attachments,
  modules,
  notes,
  noteVersions,
  type Attachment,
  type Module,
  type Note,
} from '../db/schema.js';
import { contentDisposition, exportAssetName, slugify } from '../lib/filenames.js';
import { getOwnedNote } from './notes.service.js';
import { storagePath } from './attachments.service.js';
import { tagsForNotes } from './tags.service.js';

export const EXPORT_FORMAT_VERSION = 1;

const ATTACHMENT_REF =
  /\/api\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/content(\?[^)\s"']*)?/gi;

/**
 * Replace authenticated UniNotes attachment URLs with relative paths to exported assets.
 * References to attachments that are not part of the export are neutralised rather than
 * left pointing at a private URL.
 */
export function rewriteAssetLinks(markdown: string, assets: Map<string, string>, prefix: string) {
  return markdown.replace(ATTACHMENT_REF, (_m, id: string) => {
    const name = assets.get(id.toLowerCase());
    return name ? `${prefix}${name}` : '#attachment-not-exported';
  });
}

const yamlString = (v: string) => JSON.stringify(v);

export function frontMatter(n: Note, mod: Pick<Module, 'name' | 'code'> | null, tags: string[]) {
  const lines = [
    '---',
    `title: ${yamlString(n.title)}`,
    `lecture_date: ${n.lectureDate}`,
    ...(mod ? [`module: ${yamlString(mod.name)}`] : []),
    ...(mod?.code ? [`module_code: ${yamlString(mod.code)}`] : []),
    `tags: [${tags.map(yamlString).join(', ')}]`,
    `favourite: ${n.isFavourite}`,
    `created: ${n.createdAt}`,
    `updated: ${n.updatedAt}`,
    `uninotes_id: ${n.id}`,
    '---',
    '',
  ];
  return lines.join('\n');
}

interface NoteBundle {
  note: Note;
  module: Module | null;
  tags: string[];
  attachments: Attachment[];
}

function collectBundles(ctx: AppContext, userId: string, noteRows: Note[]): NoteBundle[] {
  const ids = noteRows.map((n) => n.id);
  const tagMap = tagsForNotes(ctx.db, ids);
  const moduleIds = [...new Set(noteRows.map((n) => n.moduleId).filter((x): x is string => Boolean(x)))];
  const mods = moduleIds.length
    ? ctx.db
        .select()
        .from(modules)
        .where(and(eq(modules.userId, userId), inArray(modules.id, moduleIds)))
        .all()
    : [];
  const modMap = new Map(mods.map((m) => [m.id, m]));
  // Include attachments uploaded to the note and any of the user's attachments it references.
  const referenced = new Set<string>();
  for (const n of noteRows)
    for (const m of n.markdownContent.matchAll(ATTACHMENT_REF)) referenced.add(m[1]!.toLowerCase());
  const atts = ctx.db
    .select()
    .from(attachments)
    .where(eq(attachments.userId, userId))
    .all()
    .filter((a) => (a.noteId && ids.includes(a.noteId)) || referenced.has(a.id));
  return noteRows.map((note) => {
    const refs = new Set([...note.markdownContent.matchAll(ATTACHMENT_REF)].map((m) => m[1]!.toLowerCase()));
    return {
      note,
      module: note.moduleId ? (modMap.get(note.moduleId) ?? null) : null,
      tags: tagMap.get(note.id) ?? [],
      attachments: atts.filter((a) => a.noteId === note.id || refs.has(a.id)),
    };
  });
}

export const noteFileStem = (n: Note) => `${n.lectureDate}-${slugify(n.title, 'untitled-note', 70)}`;

function uniqueName(used: Set<string>, base: string, ext: string) {
  let name = `${base}${ext}`;
  for (let i = 2; used.has(name); i++) name = `${base}-${i}${ext}`;
  used.add(name);
  return name;
}

function renderNote(bundle: NoteBundle, assetNames: Map<string, string>, assetPrefix: string) {
  return (
    frontMatter(bundle.note, bundle.module, bundle.tags) +
    rewriteAssetLinks(bundle.note.markdownContent, assetNames, assetPrefix)
  );
}

export function exportNoteMarkdown(ctx: AppContext, userId: string, noteId: string) {
  const note = getOwnedNote(ctx.db, userId, noteId);
  const [bundle] = collectBundles(ctx, userId, [note]);
  const names = new Map(bundle!.attachments.map((a) => [a.id, exportAssetName(a.id, a.originalName)]));
  return { filename: `${noteFileStem(note)}.md`, content: renderNote(bundle!, names, 'assets/') };
}

function startZip(res: Response, filename: string) {
  const zip = new yazl.ZipFile();
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', contentDisposition('attachment', filename));
  zip.outputStream.pipe(res);
  return zip;
}

function addAssets(
  ctx: AppContext,
  zip: yazl.ZipFile,
  list: Attachment[],
  dir: string,
  names: Map<string, string>,
) {
  const added = new Set<string>();
  for (const a of list) {
    if (added.has(a.id)) continue;
    const file = storagePath(ctx, a.storageKey);
    if (!fs.existsSync(file)) continue;
    zip.addFile(file, `${dir}${names.get(a.id)}`, { mtime: new Date(a.createdAt) });
    added.add(a.id);
  }
}

function finish(zip: yazl.ZipFile, res: Response) {
  return new Promise<void>((resolve, reject) => {
    zip.outputStream.on('error', reject);
    res.on('finish', () => resolve());
    res.on('close', () => resolve());
    zip.end();
  });
}

export function streamNoteZip(ctx: AppContext, res: Response, userId: string, noteId: string) {
  const note = getOwnedNote(ctx.db, userId, noteId);
  const [bundle] = collectBundles(ctx, userId, [note]);
  const stem = noteFileStem(note);
  const names = new Map(bundle!.attachments.map((a) => [a.id, exportAssetName(a.id, a.originalName)]));
  const zip = startZip(res, `${stem}.zip`);
  zip.addBuffer(Buffer.from(renderNote(bundle!, names, 'assets/')), `${stem}/${stem}.md`, {
    mtime: new Date(note.updatedAt),
  });
  addAssets(ctx, zip, bundle!.attachments, `${stem}/assets/`, names);
  return finish(zip, res);
}

export function streamModuleZip(ctx: AppContext, res: Response, userId: string, module: Module) {
  const rows = ctx.db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.moduleId, module.id), isNull(notes.deletedAt)))
    .orderBy(notes.lectureDate)
    .all();
  const bundles = collectBundles(ctx, userId, rows);
  const root = slugify(module.code ? `${module.code}-${module.name}` : module.name, 'module');
  const allAtts = bundles.flatMap((b) => b.attachments);
  const names = new Map(allAtts.map((a) => [a.id, exportAssetName(a.id, a.originalName)]));
  const zip = startZip(res, `${root}.zip`);
  const used = new Set<string>();
  for (const b of bundles) {
    zip.addBuffer(
      Buffer.from(renderNote(b, names, 'assets/')),
      `${root}/${uniqueName(used, noteFileStem(b.note), '.md')}`,
      {
        mtime: new Date(b.note.updatedAt),
      },
    );
  }
  addAssets(ctx, zip, allAtts, `${root}/assets/`, names);
  return finish(zip, res);
}

/**
 * Full export: every non-deleted note (active and archived) as Markdown, all assets, and a
 * manifest.json with the metadata needed to migrate or restore elsewhere.
 */
export function streamFullExport(ctx: AppContext, res: Response, userId: string, includeVersions: boolean) {
  const rows = ctx.db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), isNull(notes.deletedAt)))
    .orderBy(notes.lectureDate)
    .all();
  const mods = ctx.db.select().from(modules).where(eq(modules.userId, userId)).all();
  const bundles = collectBundles(ctx, userId, rows);
  const date = new Date().toISOString().slice(0, 10);
  const root = `uninotes-export-${date}`;
  const allAtts = [...new Map(bundles.flatMap((b) => b.attachments).map((a) => [a.id, a])).values()];
  const names = new Map(allAtts.map((a) => [a.id, exportAssetName(a.id, a.originalName)]));
  const folderFor = new Map(
    mods.map((m) => [m.id, slugify(m.code ? `${m.code}-${m.name}` : m.name, 'module')]),
  );
  const zip = startZip(res, `${root}.zip`);
  const usedPerFolder = new Map<string, Set<string>>();
  const manifestNotes = [];

  for (const b of bundles) {
    const folder = b.note.moduleId ? (folderFor.get(b.note.moduleId) ?? 'unassigned') : 'unassigned';
    const used = usedPerFolder.get(folder) ?? new Set<string>();
    usedPerFolder.set(folder, used);
    const file = `notes/${folder}/${uniqueName(used, noteFileStem(b.note), '.md')}`;
    zip.addBuffer(Buffer.from(renderNote(b, names, '../../assets/')), `${root}/${file}`, {
      mtime: new Date(b.note.updatedAt),
    });
    manifestNotes.push({
      id: b.note.id,
      path: file,
      title: b.note.title,
      moduleId: b.note.moduleId,
      lectureDate: b.note.lectureDate,
      tags: b.tags,
      isFavourite: b.note.isFavourite,
      revision: b.note.revision,
      archivedAt: b.note.archivedAt,
      createdAt: b.note.createdAt,
      updatedAt: b.note.updatedAt,
      attachmentIds: b.attachments.map((a) => a.id),
    });
    if (includeVersions) {
      const versions = ctx.db
        .select()
        .from(noteVersions)
        .where(and(eq(noteVersions.noteId, b.note.id), eq(noteVersions.userId, userId)))
        .orderBy(noteVersions.createdAt)
        .all()
        .map(({ userId: _u, noteId: _n, ...v }) => v);
      if (versions.length)
        zip.addBuffer(Buffer.from(JSON.stringify(versions, null, 2)), `${root}/versions/${b.note.id}.json`);
    }
  }
  addAssets(ctx, zip, allAtts, `${root}/assets/`, names);

  const manifest = {
    format: 'uninotes-export',
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    modules: mods.map(({ userId: _u, ...m }) => ({ ...m, folder: `notes/${folderFor.get(m.id)}` })),
    notes: manifestNotes,
    attachments: allAtts.map((a) => ({
      id: a.id,
      noteId: a.noteId,
      kind: a.kind,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      originalName: a.originalName,
      sha256: a.sha256,
      path: `assets/${names.get(a.id)}`,
      createdAt: a.createdAt,
    })),
  };
  zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), `${root}/manifest.json`);
  zip.addBuffer(
    Buffer.from(
      `# UniNotes export (${date})\n\nNotes are in notes/<module>/ as Markdown with YAML front matter.\nImages and files are in assets/ and are referenced with relative paths.\nmanifest.json lists all modules, notes and attachments with their metadata.\n`,
    ),
    `${root}/README.md`,
  );
  return finish(zip, res);
}
