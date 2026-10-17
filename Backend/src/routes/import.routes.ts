import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { badRequest } from '../lib/errors.js';
import { dateOnly, defineRoute } from '../lib/route.js';
import { audit } from '../services/audit.service.js';
import { importMarkdown } from '../services/import.service.js';

export function importRoutes(ctx: AppContext) {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ctx.config.limits.importBytes, files: 1, fields: 10, fieldSize: 2048, parts: 12 },
  });

  defineRoute(router, '/api', {
    method: 'post',
    path: '/import',
    tag: 'Import',
    summary: 'Import a Markdown file as a new note (409 DUPLICATE_IMPORT unless allowDuplicate=true)',
    status: 201,
    middleware: [upload.single('file')],
    multipart: {
      file: 'file',
      moduleId: 'string',
      lectureDate: 'string',
      title: 'string',
      tags: 'string',
      allowDuplicate: 'string',
    },
    body: z.object({
      moduleId: z
        .union([z.uuid(), z.literal('')])
        .optional()
        .transform((v) => v || null),
      lectureDate: dateOnly,
      title: z.string().max(300).optional(),
      tags: z
        .string()
        .max(1000)
        .optional()
        .transform((v) =>
          v
            ? v
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
            : [],
        ),
      allowDuplicate: z
        .enum(['true', 'false'])
        .optional()
        .transform((v) => v === 'true'),
    }),
    handler: ({ req, auth, body }) => {
      if (!req.file) throw badRequest('No file uploaded (use the "file" field)');
      const note = importMarkdown(ctx, auth.user.id, { ...body, file: req.file });
      audit(ctx.db, req, auth.user.id, 'data.imported', { noteId: note.id });
      return note;
    },
  });
  return router;
}
