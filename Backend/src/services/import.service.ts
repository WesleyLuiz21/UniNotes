import path from 'node:path';
import { badRequest, conflict, tooLarge, unsupported } from '../lib/errors.js';
import { isValidDateOnly } from '../lib/time.js';
import type { AppContext } from '../context.js';
import { assertModuleOwned } from './modules.service.js';
import { contentHash, createNote, findDuplicateBySourceHash } from './notes.service.js';
import { TagSchema } from './tags.service.js';

const ALLOWED_EXT = new Set(['.md', '.markdown', '.txt']);

export interface ImportInput {
  file: { buffer: Buffer; originalname: string };
  moduleId: string | null;
  lectureDate: string | null;
  title?: string;
  tags: string[];
  allowDuplicate: boolean;
}

/** Decode strictly as UTF-8 text; reject binary content. */
export function decodeMarkdown(buffer: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw unsupported('File is not valid UTF-8 text');
  }
  if (text.includes('\u0000')) throw unsupported('File appears to be binary, not Markdown');
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

interface FrontMatter {
  title?: string;
  lectureDate?: string;
  tags?: string[];
}

/**
 * Recognise front matter written by UniNotes exports so re-imports don't accumulate duplicated
 * headers. Foreign front matter is preserved verbatim as part of the note.
 */
export function splitUniNotesFrontMatter(text: string): { body: string; meta: FrontMatter } {
  const m = /^---\n([\s\S]{0,4000}?)\n---\n?/.exec(text);
  if (!m || !/^uninotes_id:/m.test(m[1]!)) return { body: text, meta: {} };
  const meta: FrontMatter = {};
  for (const line of m[1]!.split('\n')) {
    const [, key, raw] = /^(\w+):\s*(.*)$/.exec(line) ?? [];
    if (!key || raw === undefined) continue;
    try {
      if (key === 'title') meta.title = String(JSON.parse(raw));
      if (key === 'lecture_date' && isValidDateOnly(raw.trim())) meta.lectureDate = raw.trim();
      if (key === 'tags') meta.tags = (JSON.parse(raw) as unknown[]).map(String);
    } catch {
      /* ignore malformed values */
    }
  }
  return { body: text.slice(m[0].length), meta };
}

export function inferTitle(body: string, filename: string): string {
  // Plain string scanning, not a regex: the previous pattern backtracked catastrophically on long
  // lines of whitespace (a 5 KB file blocked the event loop for minutes).
  for (const raw of body.split('\n', 2000)) {
    if (raw.startsWith('# ') || raw.startsWith('#\t')) {
      let title = raw.slice(2).trim();
      while (title.endsWith('#')) title = title.slice(0, -1);
      title = title.trim().slice(0, 300);
      if (title) return title;
    }
  }
  const stem = path.parse(filename).name.replace(/[_-]+/g, ' ').trim();
  return stem.slice(0, 300) || 'Imported note';
}

export function importMarkdown(ctx: AppContext, userId: string, input: ImportInput) {
  const ext = path.extname(input.file.originalname).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw unsupported('Only Markdown files (.md, .markdown) can be imported');
  if (input.file.buffer.length > ctx.config.limits.importBytes) throw tooLarge('Markdown file is too large');
  if (input.file.buffer.length === 0) throw badRequest('The file is empty');

  const text = decodeMarkdown(input.file.buffer);
  if (text.length > ctx.config.limits.maxMarkdownChars) throw tooLarge('Markdown file is too long');
  const { body, meta } = splitUniNotesFrontMatter(text);
  assertModuleOwned(ctx.db, userId, input.moduleId);

  // Duplicate detection never overwrites: the client must explicitly opt in to a second copy.
  const hash = contentHash(body);
  const dup = findDuplicateBySourceHash(ctx.db, userId, hash);
  if (dup && !input.allowDuplicate) {
    throw conflict('DUPLICATE_IMPORT', 'This file has already been imported', { existing: dup });
  }

  const tags = [...new Set([...input.tags, ...(meta.tags ?? [])])]
    .map((t) => TagSchema.safeParse(t))
    .filter((r) => r.success)
    .map((r) => r.data)
    .slice(0, 25);

  return createNote(ctx.db, userId, {
    title: (input.title?.trim() || meta.title || inferTitle(body, input.file.originalname)).slice(0, 300),
    markdownContent: body,
    moduleId: input.moduleId,
    lectureDate: input.lectureDate,
    tags,
    isFavourite: false,
    sourceHash: hash,
    versionReason: 'import',
  });
}
