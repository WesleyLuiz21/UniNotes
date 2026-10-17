import fs from 'node:fs';
import path from 'node:path';
import { and, eq, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import type { DB } from '../db/client.js';
import { attachments, modules, notes, type Note } from '../db/schema.js';
import { newId, sha256Hex } from '../lib/crypto.js';
import { conflict, notFound } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { reindexNote, removeFromIndex, toFtsQuery } from './search-index.js';
import { deleteUnusedTags, setNoteTags, tagsForNotes } from './tags.service.js';
import { pruneVersions, recordVersion } from './versions.service.js';

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

export interface NoteModuleRef {
  id: string;
  name: string;
  code: string | null;
  color: string;
  academicYear: string | null;
}

export function serializeNote(n: Note, extra: { module: NoteModuleRef | null; tags: string[] }) {
  return {
    id: n.id,
    title: n.title,
    markdownContent: n.markdownContent,
    moduleId: n.moduleId,
    module: extra.module,
    lectureDate: n.lectureDate,
    isFavourite: n.isFavourite,
    revision: n.revision,
    tags: extra.tags,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    archivedAt: n.archivedAt,
    deletedAt: n.deletedAt,
  };
}
export type SerializedNote = ReturnType<typeof serializeNote>;

function moduleRef(db: DB | Tx, moduleId: string | null): NoteModuleRef | null {
  if (!moduleId) return null;
  return (
    db
      .select({
        id: modules.id,
        name: modules.name,
        code: modules.code,
        color: modules.color,
        academicYear: modules.academicYear,
      })
      .from(modules)
      .where(eq(modules.id, moduleId))
      .get() ?? null
  );
}

/** Fetch a note owned by the user. Other users' notes are indistinguishable from missing ones. */
export function getOwnedNote(
  db: DB | Tx,
  userId: string,
  id: string,
  opts: { includeDeleted?: boolean } = {},
): Note {
  const n = db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))
    .get();
  if (!n || (n.deletedAt && !opts.includeDeleted)) throw notFound('Note');
  return n;
}

export function loadNote(db: DB | Tx, userId: string, id: string, opts: { includeDeleted?: boolean } = {}) {
  const n = getOwnedNote(db, userId, id, opts);
  return serializeNote(n, {
    module: moduleRef(db, n.moduleId),
    tags: tagsForNotes(db, [n.id]).get(n.id) ?? [],
  });
}

// ---------- Create / update ----------

export interface CreateNoteInput {
  title: string;
  markdownContent: string;
  moduleId: string | null;
  lectureDate: string;
  tags: string[];
  isFavourite: boolean;
  sourceHash?: string | null;
  versionReason?: 'import';
}

export function createNote(db: DB, userId: string, input: CreateNoteInput) {
  const now = nowIso();
  const id = newId();
  db.transaction((tx) => {
    tx.insert(notes)
      .values({
        id,
        userId,
        moduleId: input.moduleId,
        title: input.title,
        markdownContent: input.markdownContent,
        lectureDate: input.lectureDate,
        isFavourite: input.isFavourite,
        revision: 1,
        sourceHash: input.sourceHash ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    setNoteTags(tx, userId, id, input.tags);
    if (input.versionReason) {
      recordVersion(
        tx,
        { noteId: id, userId, revision: 1, title: input.title, markdownContent: input.markdownContent },
        input.versionReason,
      );
      tx.update(notes).set({ lastVersionAt: now }).where(eq(notes.id, id)).run();
    }
    reindexNote(tx, id);
  });
  return loadNote(db, userId, id);
}

export interface NotePatch {
  revision?: number;
  title?: string;
  markdownContent?: string;
  moduleId?: string | null;
  lectureDate?: string;
  tags?: string[];
  isFavourite?: boolean;
}

/**
 * Update a note.
 * Optimistic concurrency: changes to title/content must carry the revision the client last saw;
 * if the stored revision differs, a 409 with the current server copy is returned and nothing is
 * written. Content changes bump the revision. Metadata-only changes (module, date, tags,
 * favourite) do not require or bump the revision, so starring a note in a list never causes a
 * spurious editor conflict.
 */
export function updateNote(ctx: AppContext, userId: string, id: string, patch: NotePatch) {
  const { db } = ctx;
  const contentChange = patch.title !== undefined || patch.markdownContent !== undefined;

  return db.transaction((tx) => {
    const current = getOwnedNote(tx, userId, id);
    if (contentChange && patch.revision !== current.revision) {
      throw conflict('REVISION_CONFLICT', 'This note was changed elsewhere since you opened it', {
        current: serializeNote(current, {
          module: moduleRef(tx, current.moduleId),
          tags: tagsForNotes(tx, [id]).get(id) ?? [],
        }),
      });
    }
    const now = nowIso();
    const titleChanged = patch.title !== undefined && patch.title !== current.title;
    const contentChanged =
      patch.markdownContent !== undefined && patch.markdownContent !== current.markdownContent;
    const set: Partial<Note> = { updatedAt: now };
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.markdownContent !== undefined) set.markdownContent = patch.markdownContent;
    if (patch.moduleId !== undefined) set.moduleId = patch.moduleId;
    if (patch.lectureDate !== undefined) set.lectureDate = patch.lectureDate;
    if (patch.isFavourite !== undefined) set.isFavourite = patch.isFavourite;

    if (titleChanged || contentChanged) {
      set.revision = current.revision + 1;
      // Version policy: snapshot the pre-save state at most once per interval of editing activity.
      const last = current.lastVersionAt ? Date.parse(current.lastVersionAt) : 0;
      if (Date.now() - last >= ctx.config.versions.intervalMs) {
        recordVersion(tx, current, 'autosave');
        set.lastVersionAt = now;
        pruneVersions(tx, id, ctx.config.versions.retention);
      }
    }

    const res = tx
      .update(notes)
      .set(set)
      .where(and(eq(notes.id, id), eq(notes.userId, userId), eq(notes.revision, current.revision)))
      .run();
    if (res.changes !== 1)
      throw conflict('REVISION_CONFLICT', 'This note was changed elsewhere since you opened it');

    if (patch.tags !== undefined) {
      setNoteTags(tx, userId, id, patch.tags);
      deleteUnusedTags(tx, userId);
    }
    if (titleChanged || contentChanged || patch.tags !== undefined || patch.moduleId !== undefined)
      reindexNote(tx, id);
    return loadNote(tx, userId, id);
  });
}

// ---------- Lifecycle: archive, soft delete, restore, permanent delete ----------

export function setNoteArchived(db: DB, userId: string, id: string, archived: boolean) {
  getOwnedNote(db, userId, id);
  db.update(notes)
    .set({ archivedAt: archived ? nowIso() : null, updatedAt: nowIso() })
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))
    .run();
  return loadNote(db, userId, id);
}

export function softDeleteNote(db: DB, userId: string, id: string) {
  getOwnedNote(db, userId, id);
  db.update(notes)
    .set({ deletedAt: nowIso() })
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))
    .run();
}

export function restoreDeletedNote(db: DB, userId: string, id: string) {
  const n = getOwnedNote(db, userId, id, { includeDeleted: true });
  if (!n.deletedAt) return loadNote(db, userId, id);
  db.update(notes)
    .set({ deletedAt: null, updatedAt: nowIso() })
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))
    .run();
  return loadNote(db, userId, id);
}

/**
 * Permanently delete notes that are already in the recycle bin.
 * Versions and tag links cascade; the FTS row is removed; attachments uploaded to the note are
 * deleted unless another remaining note still references them (then they are re-homed).
 */
export function permanentlyDeleteNotes(ctx: AppContext, userId: string, ids: string[]) {
  const filesToRemove: string[] = [];
  let deleted = 0;
  ctx.db.transaction((tx) => {
    for (const id of ids) {
      const n = tx
        .select()
        .from(notes)
        .where(and(eq(notes.id, id), eq(notes.userId, userId), isNotNull(notes.deletedAt)))
        .get();
      if (!n) continue;
      const atts = tx.select().from(attachments).where(eq(attachments.noteId, id)).all();
      for (const a of atts) {
        const other = tx.get<{ id: string } | undefined>(sql`
          SELECT id FROM notes WHERE user_id = ${userId} AND id != ${id} AND instr(markdown_content, ${a.id}) > 0 LIMIT 1`);
        if (other) {
          tx.update(attachments).set({ noteId: other.id }).where(eq(attachments.id, a.id)).run();
        } else {
          tx.delete(attachments).where(eq(attachments.id, a.id)).run();
          filesToRemove.push(a.storageKey);
        }
      }
      removeFromIndex(tx, id);
      tx.delete(notes).where(eq(notes.id, id)).run();
      deleted++;
    }
    deleteUnusedTags(tx, userId);
  });
  // Files are removed only after the transaction commits, so a rollback never loses data.
  for (const key of filesToRemove) removeStoredFile(ctx, key);
  return { deleted };
}

export function removeStoredFile(ctx: AppContext, storageKey: string) {
  const file = path.join(ctx.config.paths.attachments, path.basename(storageKey));
  try {
    fs.rmSync(file, { force: true });
  } catch (err) {
    ctx.logger.warn({ err, storageKey }, 'Could not remove attachment file');
  }
}

/** Optional automatic purge of the recycle bin (RECYCLE_BIN_RETENTION_DAYS, 0 = disabled). */
export function purgeRecycleBin(ctx: AppContext) {
  const days = ctx.config.recycleBinRetentionDays;
  if (!days) return;
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = ctx.db
    .select({ id: notes.id, userId: notes.userId })
    .from(notes)
    .where(and(isNotNull(notes.deletedAt), lt(notes.deletedAt, cutoff)))
    .all();
  const byUser = new Map<string, string[]>();
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r.id]);
  for (const [userId, ids] of byUser) permanentlyDeleteNotes(ctx, userId, ids);
}

// ---------- Listing, filtering and search ----------

export const NoteQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(['active', 'archived', 'all', 'deleted']).default('active'),
  moduleId: z.union([z.uuid(), z.literal('none')]).optional(),
  academicYear: z.string().trim().max(20).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  tags: z
    .string()
    .max(500)
    .optional()
    .transform((v) =>
      v
        ? [
            ...new Set(
              v
                .split(',')
                .map((t) => t.trim().toLowerCase())
                .filter(Boolean),
            ),
          ].slice(0, 10)
        : [],
    ),
  favourite: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  updatedWithinDays: z.coerce.number().int().min(1).max(3650).optional(),
  sort: z.enum(['relevance', 'lecture_desc', 'lecture_asc', 'updated', 'title']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
type ParsedNoteQuery = z.output<typeof NoteQuerySchema>;
export type NoteQuery = Omit<ParsedNoteQuery, 'favourite' | 'tags'> & {
  favourite?: boolean;
  tags?: string[];
};

interface NoteRow {
  id: string;
  title: string;
  excerpt_src: string;
  module_id: string | null;
  lecture_date: string;
  is_favourite: number;
  revision: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
  m_name: string | null;
  m_code: string | null;
  m_color: string | null;
  m_year: string | null;
  snippet?: string | null;
  title_hl?: string | null;
}

/** Plain-text preview from Markdown, for list cards. */
export function excerpt(markdown: string, max = 180): string {
  const text = markdown
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s*\[[ xX]\]\s+/gm, '')
    .replace(/\$([^$\n]+)\$/g, '$1')
    .replace(/[*_~`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Marker characters used to delimit highlighted ranges in search snippets (rendered safely client-side). */
export const HL_START = '\u0001';
export const HL_END = '\u0002';

export function queryNotes(db: DB, userId: string, f: NoteQuery) {
  const where: SQL[] = [sql`n.user_id = ${userId}`];
  if (f.status === 'active') where.push(sql`n.deleted_at IS NULL AND n.archived_at IS NULL`);
  else if (f.status === 'archived') where.push(sql`n.deleted_at IS NULL AND n.archived_at IS NOT NULL`);
  else if (f.status === 'all') where.push(sql`n.deleted_at IS NULL`);
  else where.push(sql`n.deleted_at IS NOT NULL`);

  if (f.moduleId === 'none') where.push(sql`n.module_id IS NULL`);
  else if (f.moduleId) where.push(sql`n.module_id = ${f.moduleId}`);
  if (f.academicYear) where.push(sql`m.academic_year = ${f.academicYear}`);
  if (f.date) where.push(sql`n.lecture_date = ${f.date}`);
  if (f.from) where.push(sql`n.lecture_date >= ${f.from}`);
  if (f.to) where.push(sql`n.lecture_date <= ${f.to}`);
  if (f.favourite !== undefined) where.push(sql`n.is_favourite = ${f.favourite ? 1 : 0}`);
  if (f.updatedWithinDays) {
    where.push(sql`n.updated_at >= ${new Date(Date.now() - f.updatedWithinDays * 86_400_000).toISOString()}`);
  }
  for (const tag of f.tags ?? []) {
    where.push(
      sql`EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id AND t.name = ${tag})`,
    );
  }

  const fts = f.q ? toFtsQuery(f.q) : null;
  const searching = fts !== null;
  if (f.q && !searching) {
    // Query contained no searchable terms (e.g. only punctuation): nothing can match.
    return { items: [], total: 0, page: f.page, pageSize: f.pageSize };
  }
  const sort = f.sort ?? (searching ? 'relevance' : 'updated');
  const order =
    sort === 'relevance' && searching
      ? sql`fts.rank`
      : sort === 'lecture_desc'
        ? sql`n.lecture_date DESC, n.updated_at DESC`
        : sort === 'lecture_asc'
          ? sql`n.lecture_date ASC, n.updated_at ASC`
          : sort === 'title'
            ? sql`n.title COLLATE NOCASE ASC`
            : sql`n.updated_at DESC`;

  const ftsJoin = searching
    ? sql`JOIN (
        SELECT note_id,
          bm25(notes_fts, 0, 10.0, 1.0, 4.0, 2.0) AS rank,
          snippet(notes_fts, 2, char(1), char(2), '…', 18) AS snippet,
          highlight(notes_fts, 1, char(1), char(2)) AS title_hl
        FROM notes_fts WHERE notes_fts MATCH ${fts}
      ) fts ON fts.note_id = n.id`
    : sql``;
  const whereSql = sql.join(where, sql` AND `);

  const total =
    db.get<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM notes n LEFT JOIN modules m ON m.id = n.module_id ${ftsJoin} WHERE ${whereSql}`,
    )?.n ?? 0;

  const rows = db.all<NoteRow>(sql`
    SELECT n.id, n.title, substr(n.markdown_content, 1, 600) AS excerpt_src, n.module_id, n.lecture_date, n.is_favourite,
      n.revision, n.created_at, n.updated_at, n.archived_at, n.deleted_at,
      m.name AS m_name, m.code AS m_code, m.color AS m_color, m.academic_year AS m_year
      ${searching ? sql`, fts.snippet AS snippet, fts.title_hl AS title_hl` : sql``}
    FROM notes n
    LEFT JOIN modules m ON m.id = n.module_id
    ${ftsJoin}
    WHERE ${whereSql}
    ORDER BY ${order}
    LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`);

  const tagMap = tagsForNotes(
    db,
    rows.map((r) => r.id),
  );
  const items = rows.map((r) => ({
    id: r.id,
    title: r.title,
    excerpt: excerpt(r.excerpt_src),
    moduleId: r.module_id,
    module:
      r.module_id && r.m_name
        ? {
            id: r.module_id,
            name: r.m_name,
            code: r.m_code,
            color: r.m_color ?? '#3B82F6',
            academicYear: r.m_year,
          }
        : null,
    lectureDate: r.lecture_date,
    isFavourite: Boolean(r.is_favourite),
    revision: r.revision,
    tags: tagMap.get(r.id) ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archivedAt: r.archived_at,
    deletedAt: r.deleted_at,
    ...(searching ? { snippet: r.snippet ?? '', titleHighlight: r.title_hl ?? r.title } : {}),
  }));
  return { items, total, page: f.page, pageSize: f.pageSize };
}

export const findDuplicateBySourceHash = (db: DB, userId: string, hash: string) =>
  db
    .select({ id: notes.id, title: notes.title })
    .from(notes)
    .where(and(eq(notes.userId, userId), isNull(notes.deletedAt), eq(notes.sourceHash, hash)))
    .get();

export const contentHash = (markdown: string) => sha256Hex(markdown.replace(/\r\n/g, '\n'));
