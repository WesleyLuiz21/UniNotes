import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { defineRoute, idParam } from '../lib/route.js';
import { audit } from '../services/audit.service.js';
import {
  createModule,
  deleteModule,
  getOwnedModule,
  listModules,
  ModuleInputSchema,
  moduleNoteCount,
  ModulePatchSchema,
  serializeModule,
  setModuleArchived,
  updateModule,
} from '../services/modules.service.js';

const ModuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  description: z.string(),
  academicYear: z.string().nullable(),
  color: z.string(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  noteCount: z.number(),
});

export function moduleRoutes(ctx: AppContext) {
  const router = Router();
  const p = '/api/modules';
  const { db } = ctx;

  defineRoute(router, p, {
    method: 'get',
    path: '',
    tag: 'Modules',
    summary: 'List modules with note counts',
    query: z.object({ status: z.enum(['active', 'archived', 'all']).default('active') }),
    response: z.array(ModuleSchema),
    handler: ({ auth, query }) => listModules(db, auth.user.id, query.status),
  });

  defineRoute(router, p, {
    method: 'post',
    path: '',
    tag: 'Modules',
    summary: 'Create a module',
    status: 201,
    body: ModuleInputSchema,
    response: ModuleSchema,
    handler: ({ auth, body }) => createModule(db, auth.user.id, body),
  });

  defineRoute(router, p, {
    method: 'get',
    path: '/:id',
    tag: 'Modules',
    summary: 'Get a module',
    params: idParam,
    response: ModuleSchema,
    handler: ({ auth, params }) =>
      serializeModule(getOwnedModule(db, auth.user.id, params.id), moduleNoteCount(db, params.id)),
  });

  defineRoute(router, p, {
    method: 'patch',
    path: '/:id',
    tag: 'Modules',
    summary: 'Update a module',
    params: idParam,
    body: ModulePatchSchema,
    response: ModuleSchema,
    handler: ({ auth, params, body }) => updateModule(db, auth.user.id, params.id, body),
  });

  for (const archived of [true, false]) {
    defineRoute(router, p, {
      method: 'post',
      path: archived ? '/:id/archive' : '/:id/unarchive',
      tag: 'Modules',
      summary: archived ? 'Archive a module' : 'Restore an archived module',
      params: idParam,
      response: ModuleSchema,
      handler: ({ auth, params }) => setModuleArchived(db, auth.user.id, params.id, archived),
    });
  }

  defineRoute(router, p, {
    method: 'delete',
    path: '/:id',
    tag: 'Modules',
    summary: 'Delete a module (requires typing its name; its notes are kept and become unassigned)',
    params: idParam,
    body: z.object({ confirmName: z.string().max(200) }),
    response: z.object({ notesUnassigned: z.number() }),
    handler: ({ req, auth, params, body }) => {
      const result = deleteModule(db, auth.user.id, params.id, body.confirmName);
      audit(db, req, auth.user.id, 'module.deleted', { moduleId: params.id, ...result });
      return result;
    },
  });

  return router;
}
