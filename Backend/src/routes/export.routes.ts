import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { contentDisposition } from '../lib/filenames.js';
import { defineRoute, idParam } from '../lib/route.js';
import { audit } from '../services/audit.service.js';
import {
  exportNoteMarkdown,
  streamFullExport,
  streamModuleZip,
  streamNoteZip,
} from '../services/export.service.js';
import { getOwnedModule } from '../services/modules.service.js';

export function exportRoutes(ctx: AppContext) {
  const router = Router();
  const p = '/api/export';

  defineRoute(router, p, {
    method: 'get',
    path: '/notes/:id/markdown',
    tag: 'Export',
    summary: 'Download a note as Markdown (asset links rewritten to relative assets/ paths)',
    params: idParam,
    produces: 'text/markdown',
    handler: ({ res, auth, params }) => {
      const { filename, content } = exportNoteMarkdown(ctx, auth.user.id, params.id);
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', contentDisposition('attachment', filename));
      res.send(content);
    },
  });

  defineRoute(router, p, {
    method: 'get',
    path: '/notes/:id/zip',
    tag: 'Export',
    summary: 'Download a note and its images/files as a ZIP',
    params: idParam,
    produces: 'application/zip',
    handler: ({ res, auth, params }) => streamNoteZip(ctx, res, auth.user.id, params.id),
  });

  defineRoute(router, p, {
    method: 'get',
    path: '/modules/:id/zip',
    tag: 'Export',
    summary: 'Download every note in a module (with assets) as a ZIP',
    params: idParam,
    produces: 'application/zip',
    handler: ({ res, auth, params }) =>
      streamModuleZip(ctx, res, auth.user.id, getOwnedModule(ctx.db, auth.user.id, params.id)),
  });

  defineRoute(router, p, {
    method: 'get',
    path: '/all',
    tag: 'Export',
    summary: 'Full export of all notes, assets and a metadata manifest as a ZIP',
    query: z.object({ includeVersions: z.enum(['true', 'false']).default('true') }),
    produces: 'application/zip',
    handler: ({ req, res, auth, query }) => {
      audit(ctx.db, req, auth.user.id, 'data.exported', { scope: 'all' });
      return streamFullExport(ctx, res, auth.user.id, query.includeVersions === 'true');
    },
  });

  return router;
}
