import { sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';

// Executor type covering both the root db and a transaction handle.
type Exec = Pick<DB, 'run' | 'all' | 'get'>;

/**
 * Keep notes_fts in sync. Always call inside the same transaction as the note mutation so the
 * index can never disagree with the notes table.
 */
export function reindexNote(tx: Exec, noteId: string) {
  tx.run(sql`DELETE FROM notes_fts WHERE note_id = ${noteId}`);
  tx.run(sql`
    INSERT INTO notes_fts (note_id, title, content, tags, module)
    SELECT n.id, n.title, n.markdown_content,
      COALESCE((SELECT group_concat(t.name, ' ') FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id), ''),
      COALESCE(m.name || ' ' || COALESCE(m.code, ''), '')
    FROM notes n LEFT JOIN modules m ON m.id = n.module_id
    WHERE n.id = ${noteId}`);
}

export function reindexModuleNotes(tx: Exec, moduleId: string) {
  const rows = tx.all<{ id: string }>(sql`SELECT id FROM notes WHERE module_id = ${moduleId}`);
  for (const r of rows) reindexNote(tx, r.id);
}

export function removeFromIndex(tx: Exec, noteId: string) {
  tx.run(sql`DELETE FROM notes_fts WHERE note_id = ${noteId}`);
}

/** Full rebuild; used after restores or if the index is ever suspected to be stale. */
export function rebuildSearchIndex(db: DB) {
  db.transaction((tx) => {
    tx.run(sql`DELETE FROM notes_fts`);
    const rows = tx.all<{ id: string }>(sql`SELECT id FROM notes`);
    for (const r of rows) reindexNote(tx, r.id);
  });
}

/**
 * Convert free text into a safe FTS5 MATCH expression. User input is never passed through as FTS
 * syntax: every term is quoted (so operators like NEAR/OR/column filters are inert) and given a
 * prefix wildcard. Terms are ANDed. Returns null when there is nothing searchable.
 */
export function toFtsQuery(input: string): string | null {
  const terms = input.normalize('NFKC').match(/[\p{L}\p{N}_]+/gu) ?? [];
  const unique = [...new Set(terms.map((t) => t.toLowerCase()))].slice(0, 16);
  if (unique.length === 0) return null;
  return unique.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ');
}
