import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { users } from '../db/schema.js';
import { audit } from '../services/audit.service.js';
import { listNoteAttachments } from '../services/attachments.service.js';
import { assertModuleOwned } from '../services/modules.service.js';
import {
  createNote,
  loadNote,
  NoteQuerySchema,
  permanentlyDeleteNotes,
  queryNotes,
  restoreDeletedNote,
  setNoteArchived,
  softDeleteNote,
  updateNote,
} from '../services/notes.service.js';
import { TagListSchema } from '../services/tags.service.js';
import { getVersion, listVersions, restoreVersion, saveManualVersion } from '../services/versions.service.js';
import { parsePreferences } from '../services/users.service.js';
import { dateOnly, defineRoute, idParam, WithMeta } from '../lib/route.js';
import { nowIso } from '../lib/time.js';

export const TitleSchema = z.string().trim().max(300);
const MarkdownSchema = z.string().max(1_000_000, 'Note is too long (max 1,000,000 characters)');

const NoteSchema = z.object({
  id: z.string(),
  title: z.string(),
  markdownContent: z.string(),
  moduleId: z.string().nullable(),
  module: z
    .object({ id: z.string(), name: z.string(), code: z.string().nullable(), color: z.string() })
    .nullable(),
  lectureDate: z.string(),
  isFavourite: z.boolean(),
  revision: z.number(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
});

const CreateBody = z.object({
  title: TitleSchema.default(''),
  markdownContent: MarkdownSchema.default(''),
  moduleId: z.uuid().nullable().default(null),
  lectureDate: dateOnly,
  tags: TagListSchema.default([]),
  isFavourite: z.boolean().default(false),
});

const PatchBody = z
  .object({
    revision: z.number().int().min(1).optional(),
    title: TitleSchema.optional(),
    markdownContent: MarkdownSchema.optional(),
    moduleId: z.uuid().nullable().optional(),
    lectureDate: dateOnly.optional(),
    tags: TagListSchema.optional(),
    isFavourite: z.boolean().optional(),
  })
  .refine((b) => (b.title === undefined && b.markdownContent === undefined) || b.revision !== undefined, {
    message: 'revision is required when changing title or content',
    path: ['revision'],
  });

export const untitled = (title: string) => title.trim() || 'Untitled note';

export function noteRoutes(ctx: AppContext) {
  const router = Router();
  const p = '/api/notes';
  const { db } = ctx;

  defineRoute(router, p, {
    method: 'get',
    path: '',
    tag: 'Notes',
    summary: 'List notes with filters and pagination',
    query: NoteQuerySchema.omit({ q: true }),
    handler: ({ auth, query }) => {
      const { items, ...meta } = queryNotes(db, auth.user.id, { ...query, q: undefined });
      return new WithMeta(items, meta);
    },
  });

  defineRoute(router, p, {
    method: 'post',
    path: '',
    tag: 'Notes',
    summary: 'Create a note',
    status: 201,
    body: CreateBody,
    response: NoteSchema,
    handler: ({ auth, body }) => {
      assertModuleOwned(db, auth.user.id, body.moduleId);
      const note = createNote(db, auth.user.id, { ...body, title: untitled(body.title) });
      if (body.moduleId) {
        const prefs = parsePreferences(auth.user.preferences);
        if (prefs.lastModuleId !== body.moduleId) {
          db.update(users)
            .set({
              preferences: JSON.stringify({ ...prefs, lastModuleId: body.moduleId }),
              updatedAt: nowIso(),
            })
            .where(eq(users.id, auth.user.id))
            .run();
        }
      }
      return note;
    },
  });

  defineRoute(router, p, {
    method: 'post',
    path: '/permanent-delete',
    tag: 'Notes',
    summary: 'Permanently delete notes from the recycle bin',
    body: z
      .object({ ids: z.array(z.uuid()).max(500).optional(), all: z.boolean().optional() })
      .refine((b) => b.all || (b.ids && b.ids.length > 0), 'Provide ids or all: true'),
    response: z.object({ deleted: z.number() }),
    handler: ({ req, auth, body }) => {
      const ids = body.all
        ? queryNotes(db, auth.user.id, { status: 'deleted', page: 1, pageSize: 100_000 }).items.map(
            (n) => n.id,
          )
        : body.ids!;
      const result = permanentlyDeleteNotes(ctx, auth.user.id, ids);
      audit(db, req, auth.user.id, 'notes.permanently_deleted', { count: result.deleted });
      return result;
    },
  });

  defineRoute(router, p, {
    method: 'get',
    path: '/:id',
    tag: 'Notes',
    summary: 'Get a note (use includeDeleted=true to view one in the recycle bin)',
    params: idParam,
    query: z.object({ includeDeleted: z.enum(['true', 'false']).optional() }),
    response: NoteSchema,
    handler: ({ auth, params, query }) =>
      loadNote(db, auth.user.id, params.id, { includeDeleted: query.includeDeleted === 'true' }),
  });

  defineRoute(router, p, {
    method: 'patch',
    path: '/:id',
    tag: 'Notes',
    summary: 'Update a note (title/content changes require the current revision; 409 on conflict)',
    params: idParam,
    body: PatchBody,
    response: NoteSchema,
    handler: ({ auth, params, body }) => {
      if (body.moduleId) assertModuleOwned(db, auth.user.id, body.moduleId);
      const patch = { ...body, ...(body.title !== undefined ? { title: untitled(body.title) } : {}) };
      return updateNote(ctx, auth.user.id, params.id, patch);
    },
  });

  defineRoute(router, p, {
    method: 'delete',
    path: '/:id',
    tag: 'Notes',
    summary: 'Move a note to the recycle bin (soft delete)',
    params: idParam,
    status: 204,
    handler: ({ auth, params }) => softDeleteNote(db, auth.user.id, params.id),
  });

  defineRoute(router, p, {
    method: 'post',
    path: '/:id/restore',
    tag: 'Notes',
    summary: 'Restore a note from the recycle bin',
    params: idParam,
    response: NoteSchema,
    handler: ({ auth, params }) => restoreDeletedNote(db, auth.user.id, params.id),
  });

  for (const archived of [true, false]) {
    defineRoute(router, p, {
      method: 'post',
      path: archived ? '/:id/archive' : '/:id/unarchive',
      tag: 'Notes',
      summary: archived ? 'Archive a note' : 'Unarchive a note',
      params: idParam,
      response: NoteSchema,
      handler: ({ auth, params }) => setNoteArchived(db, auth.user.id, params.id, archived),
    });
  }

  defineRoute(router, p, {
    method: 'get',
    path: '/:id/versions',
    tag: 'Versions',
    summary: 'List saved versions of a note',
    params: idParam,
    handler: ({ auth, params }) => listVersions(db, auth.user.id, params.id),
  });

  defineRoute(router, p, {
    method: 'post',
    path: '/:id/versions',
    tag: 'Versions',
    summary: 'Save the current state as a version',
    status: 201,
    params: idParam,
    handler: ({ auth, params }) => saveManualVersion(ctx, auth.user.id, params.id),
  });

  const versionParams = z.object({ id: z.uuid(), versionId: z.uuid() });

  defineRoute(router, p, {
    method: 'get',
    path: '/:id/versions/:versionId',
    tag: 'Versions',
    summary: 'Get the content of a version',
    params: versionParams,
    handler: ({ auth, params }) => getVersion(db, auth.user.id, params.id, params.versionId),
  });

  defineRoute(router, p, {
    method: 'post',
    path: '/:id/versions/:versionId/restore',
    tag: 'Versions',
    summary: 'Restore a version (creates a new revision; history is kept)',
    params: versionParams,
    response: NoteSchema,
    handler: ({ auth, params }) => restoreVersion(ctx, auth.user.id, params.id, params.versionId),
  });

  defineRoute(router, p, {
    method: 'get',
    path: '/:id/attachments',
    tag: 'Attachments',
    summary: 'List attachments uploaded to a note',
    params: idParam,
    handler: ({ auth, params }) => listNoteAttachments(ctx, auth.user.id, params.id),
  });

  return router;
}
