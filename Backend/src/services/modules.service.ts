import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db/client.js';
import { modules, notes, type Module } from '../db/schema.js';
import { newId } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { reindexModuleNotes, reindexNote } from './search-index.js';

export const MODULE_COLORS = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
  '#F97316',
  '#6366F1',
  '#84CC16',
] as const;

export const ModuleInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z
    .string()
    .trim()
    .max(30)
    .nullish()
    .transform((v) => v || null),
  description: z.string().trim().max(2000).default(''),
  academicYear: z
    .string()
    .trim()
    .max(20)
    .regex(/^[\w ./-]*$/, 'Use a format like 2025/26')
    .nullish()
    .transform((v) => v || null),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex colour like #3B82F6')
    .transform((v) => v.toUpperCase())
    .default(MODULE_COLORS[0]),
});
export const ModulePatchSchema = ModuleInputSchema.partial();

export function serializeModule(m: Module, noteCount?: number) {
  return {
    id: m.id,
    name: m.name,
    code: m.code,
    description: m.description,
    academicYear: m.academicYear,
    color: m.color,
    archivedAt: m.archivedAt,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    ...(noteCount === undefined ? {} : { noteCount }),
  };
}

export function getOwnedModule(db: DB, userId: string, id: string): Module {
  const m = db
    .select()
    .from(modules)
    .where(and(eq(modules.id, id), eq(modules.userId, userId)))
    .get();
  if (!m) throw notFound('Module');
  return m;
}

/** Verify that a module id (from user input) belongs to the user. */
export function assertModuleOwned(db: DB, userId: string, moduleId: string | null | undefined) {
  if (moduleId) getOwnedModule(db, userId, moduleId);
}

export function listModules(db: DB, userId: string, status: 'active' | 'archived' | 'all') {
  const statusSql =
    status === 'active'
      ? sql`AND m.archived_at IS NULL`
      : status === 'archived'
        ? sql`AND m.archived_at IS NOT NULL`
        : sql``;
  const rows = db.all<Module & { note_count: number }>(sql`
    SELECT m.id, m.user_id AS userId, m.name, m.code, m.description, m.academic_year AS academicYear, m.color,
      m.archived_at AS archivedAt, m.created_at AS createdAt, m.updated_at AS updatedAt,
      (SELECT COUNT(*) FROM notes n WHERE n.module_id = m.id AND n.deleted_at IS NULL AND n.archived_at IS NULL) AS note_count
    FROM modules m
    WHERE m.user_id = ${userId} ${statusSql}
    ORDER BY m.academic_year DESC NULLS LAST, lower(m.name)`);
  return rows.map((r) => serializeModule(r, r.note_count));
}

export function moduleNoteCount(db: DB, moduleId: string) {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(notes)
      .where(
        sql`${notes.moduleId} = ${moduleId} AND ${notes.deletedAt} IS NULL AND ${notes.archivedAt} IS NULL`,
      )
      .get()?.n ?? 0
  );
}

export function createModule(db: DB, userId: string, input: z.output<typeof ModuleInputSchema>) {
  const now = nowIso();
  const row = { id: newId(), userId, ...input, createdAt: now, updatedAt: now };
  db.insert(modules).values(row).run();
  return serializeModule(getOwnedModule(db, userId, row.id), 0);
}

export function updateModule(db: DB, userId: string, id: string, patch: z.output<typeof ModulePatchSchema>) {
  const existing = getOwnedModule(db, userId, id);
  db.transaction((tx) => {
    tx.update(modules)
      .set({ ...patch, updatedAt: nowIso() })
      .where(and(eq(modules.id, id), eq(modules.userId, userId)))
      .run();
    // Module name/code are part of each note's search document.
    if (
      (patch.name !== undefined && patch.name !== existing.name) ||
      (patch.code !== undefined && patch.code !== existing.code)
    ) {
      reindexModuleNotes(tx, id);
    }
  });
  return serializeModule(getOwnedModule(db, userId, id), moduleNoteCount(db, id));
}

export function setModuleArchived(db: DB, userId: string, id: string, archived: boolean) {
  getOwnedModule(db, userId, id);
  db.update(modules)
    .set({ archivedAt: archived ? nowIso() : null, updatedAt: nowIso() })
    .where(and(eq(modules.id, id), eq(modules.userId, userId)))
    .run();
  return serializeModule(getOwnedModule(db, userId, id), moduleNoteCount(db, id));
}

/**
 * Delete policy: a module can only be deleted with an explicit confirmation of its name.
 * Its notes are never deleted; they are kept and become unassigned ("No module").
 */
export function deleteModule(db: DB, userId: string, id: string, confirmName: string) {
  const m = getOwnedModule(db, userId, id);
  if (confirmName.trim() !== m.name) throw badRequest('Type the module name exactly to confirm deletion');
  const affected = db.all<{ id: string }>(
    sql`SELECT id FROM notes WHERE module_id = ${id} AND user_id = ${userId}`,
  );
  db.transaction((tx) => {
    tx.run(
      sql`UPDATE notes SET module_id = NULL, updated_at = ${nowIso()} WHERE module_id = ${id} AND user_id = ${userId}`,
    );
    tx.delete(modules)
      .where(and(eq(modules.id, id), eq(modules.userId, userId)))
      .run();
    // The module name was part of each note's search document.
    for (const r of affected) reindexNote(tx, r.id);
  });
  return { notesUnassigned: affected.length };
}
