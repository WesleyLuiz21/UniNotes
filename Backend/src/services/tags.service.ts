import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db/client.js';
import { noteTags, tags } from '../db/schema.js';
import { newId } from '../lib/crypto.js';
import { nowIso } from '../lib/time.js';

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

export const TagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(40)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N}_\-/.]*$/u, 'Tags may contain letters, numbers, - _ / .');

export const TagListSchema = z
  .array(TagSchema)
  .max(25)
  .transform((list) => [...new Set(list)]);

export function setNoteTags(tx: Tx | DB, userId: string, noteId: string, names: string[]) {
  tx.delete(noteTags).where(eq(noteTags.noteId, noteId)).run();
  if (names.length === 0) return;
  const now = nowIso();
  for (const name of names) {
    tx.insert(tags).values({ id: newId(), userId, name, createdAt: now }).onConflictDoNothing().run();
  }
  const rows = tx
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.userId, userId), inArray(tags.name, names)))
    .all();
  tx.insert(noteTags)
    .values(rows.map((r) => ({ noteId, tagId: r.id })))
    .run();
}

export function deleteUnusedTags(tx: Tx | DB, userId: string) {
  tx.run(sql`DELETE FROM tags WHERE user_id = ${userId} AND id NOT IN (SELECT tag_id FROM note_tags)`);
}

export function tagsForNotes(db: Tx | DB, noteIds: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (noteIds.length === 0) return map;
  const rows = db
    .select({ noteId: noteTags.noteId, name: tags.name })
    .from(noteTags)
    .innerJoin(tags, eq(tags.id, noteTags.tagId))
    .where(inArray(noteTags.noteId, noteIds))
    .orderBy(tags.name)
    .all();
  for (const r of rows) {
    const list = map.get(r.noteId) ?? [];
    list.push(r.name);
    map.set(r.noteId, list);
  }
  return map;
}

/** All tags with counts of non-deleted notes. */
export function listTags(db: DB, userId: string) {
  return db.all<{ name: string; count: number }>(sql`
    SELECT t.name AS name, COUNT(n.id) AS count
    FROM tags t
    JOIN note_tags nt ON nt.tag_id = t.id
    JOIN notes n ON n.id = nt.note_id AND n.deleted_at IS NULL
    WHERE t.user_id = ${userId}
    GROUP BY t.id
    ORDER BY t.name`);
}
