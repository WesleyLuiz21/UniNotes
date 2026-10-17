import { and, desc, eq, notInArray } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import type { DB } from '../db/client.js';
import { noteVersions, notes, type NoteVersion } from '../db/schema.js';
import { newId } from '../lib/crypto.js';
import { notFound } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { getOwnedNote, loadNote } from './notes.service.js';
import { reindexNote } from './search-index.js';

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

/*
 * Revision retention policy (documented in README):
 *  - Autosaves do not create a version per keystroke. Before a content save, the pre-save state
 *    is captured only if no version was captured in the last VERSION_INTERVAL_MINUTES (default 10).
 *  - A manual "Save version" always captures the current state.
 *  - Restoring captures the current state ("pre-restore") and the restored state ("restore"),
 *    and the restored content becomes a new revision; nothing in history is overwritten.
 *  - The newest VERSION_RETENTION (default 100) versions per note are kept; older ones are pruned.
 *  - Versions are removed only when their note is permanently deleted.
 */

export function recordVersion(
  tx: Tx | DB,
  note: {
    noteId?: string;
    id?: string;
    userId: string;
    revision: number;
    title: string;
    markdownContent: string;
  },
  reason: NoteVersion['reason'],
) {
  tx.insert(noteVersions)
    .values({
      id: newId(),
      noteId: (note.noteId ?? note.id)!,
      userId: note.userId,
      revision: note.revision,
      title: note.title,
      markdownContent: note.markdownContent,
      reason,
      createdAt: nowIso(),
    })
    .run();
}

export function pruneVersions(tx: Tx | DB, noteId: string, keep: number) {
  const keepIds = tx
    .select({ id: noteVersions.id })
    .from(noteVersions)
    .where(eq(noteVersions.noteId, noteId))
    .orderBy(desc(noteVersions.createdAt))
    .limit(keep)
    .all()
    .map((r) => r.id);
  if (keepIds.length < keep) return;
  tx.delete(noteVersions)
    .where(and(eq(noteVersions.noteId, noteId), notInArray(noteVersions.id, keepIds)))
    .run();
}

export function listVersions(db: DB, userId: string, noteId: string) {
  getOwnedNote(db, userId, noteId);
  return db
    .select({
      id: noteVersions.id,
      revision: noteVersions.revision,
      title: noteVersions.title,
      reason: noteVersions.reason,
      createdAt: noteVersions.createdAt,
      markdownContent: noteVersions.markdownContent,
    })
    .from(noteVersions)
    .where(and(eq(noteVersions.noteId, noteId), eq(noteVersions.userId, userId)))
    .orderBy(desc(noteVersions.createdAt))
    .all()
    .map(({ markdownContent, ...v }) => ({ ...v, characters: markdownContent.length }));
}

export function getVersion(db: DB, userId: string, noteId: string, versionId: string) {
  getOwnedNote(db, userId, noteId);
  const v = db
    .select()
    .from(noteVersions)
    .where(
      and(eq(noteVersions.id, versionId), eq(noteVersions.noteId, noteId), eq(noteVersions.userId, userId)),
    )
    .get();
  if (!v) throw notFound('Version');
  return {
    id: v.id,
    revision: v.revision,
    title: v.title,
    reason: v.reason,
    createdAt: v.createdAt,
    markdownContent: v.markdownContent,
  };
}

export function saveManualVersion(ctx: AppContext, userId: string, noteId: string) {
  ctx.db.transaction((tx) => {
    const n = getOwnedNote(tx, userId, noteId);
    recordVersion(tx, n, 'manual');
    tx.update(notes).set({ lastVersionAt: nowIso() }).where(eq(notes.id, noteId)).run();
    pruneVersions(tx, noteId, ctx.config.versions.retention);
  });
  return listVersions(ctx.db, userId, noteId)[0];
}

export function restoreVersion(ctx: AppContext, userId: string, noteId: string, versionId: string) {
  return ctx.db.transaction((tx) => {
    const n = getOwnedNote(tx, userId, noteId);
    const v = tx
      .select()
      .from(noteVersions)
      .where(
        and(eq(noteVersions.id, versionId), eq(noteVersions.noteId, noteId), eq(noteVersions.userId, userId)),
      )
      .get();
    if (!v) throw notFound('Version');
    const now = nowIso();
    recordVersion(tx, n, 'pre-restore');
    const revision = n.revision + 1;
    tx.update(notes)
      .set({
        title: v.title,
        markdownContent: v.markdownContent,
        revision,
        updatedAt: now,
        lastVersionAt: now,
      })
      .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
      .run();
    recordVersion(tx, { ...n, revision, title: v.title, markdownContent: v.markdownContent }, 'restore');
    pruneVersions(tx, noteId, ctx.config.versions.retention);
    reindexNote(tx, noteId);
    return loadNote(tx, userId, noteId);
  });
}
