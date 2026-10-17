import fs from 'node:fs';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { badRequest, notFound } from '../lib/errors.js';
import { contentDisposition } from '../lib/filenames.js';
import { defineRoute, idParam } from '../lib/route.js';
import {
  deleteAttachment,
  getOwnedAttachment,
  serializeAttachment,
  storagePath,
  storeUpload,
} from '../services/attachments.service.js';

const AttachmentSchema = z.object({
  id: z.string(),
  noteId: z.string().nullable(),
  kind: z.enum(['image', 'file']),
  mimeType: z.string(),
  sizeBytes: z.number(),
  originalName: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  createdAt: z.string(),
  url: z.string(),
});

export function attachmentRoutes(ctx: AppContext) {
  const router = Router();
  const p = '/api/attachments';
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: Math.max(ctx.config.limits.imageBytes, ctx.config.limits.attachmentBytes),
      files: 1,
      fields: 5,
      fieldSize: 1024,
      parts: 6,
    },
  });

  defineRoute(router, p, {
    method: 'post',
    path: '',
    tag: 'Attachments',
    summary: 'Upload an image (PNG/JPEG/WebP, re-encoded) or PDF to a note',
    status: 201,
    middleware: [upload.single('file')],
    multipart: { file: 'file', noteId: 'string' },
    body: z.object({ noteId: z.uuid() }),
    response: AttachmentSchema,
    handler: async ({ req, auth, body }) => {
      if (!req.file) throw badRequest('No file uploaded (use the "file" field)');
      return storeUpload(ctx, auth.user.id, body.noteId, req.file);
    },
  });

  defineRoute(router, p, {
    method: 'get',
    path: '/:id',
    tag: 'Attachments',
    summary: 'Attachment metadata',
    params: idParam,
    response: AttachmentSchema,
    handler: ({ auth, params }) => serializeAttachment(getOwnedAttachment(ctx, auth.user.id, params.id)),
  });

  defineRoute(router, p, {
    method: 'get',
    path: '/:id/content',
    tag: 'Attachments',
    summary: 'Download attachment content (images inline, documents always as downloads)',
    params: idParam,
    query: z.object({ download: z.enum(['1', 'true']).optional() }),
    produces: 'application/octet-stream',
    handler: ({ req, res, auth, params, query }) => {
      const a = getOwnedAttachment(ctx, auth.user.id, params.id);
      const file = storagePath(ctx, a.storageKey);
      if (!fs.existsSync(file)) throw notFound('Attachment');
      const etag = `"${a.sha256.slice(0, 32)}"`;
      // Private (browser-only) caching; content for an id never changes.
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader('ETag', etag);
      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }
      const inline = a.kind === 'image' && !query.download;
      res.setHeader('Content-Type', a.mimeType);
      res.setHeader('Content-Length', String(a.sizeBytes));
      res.setHeader(
        'Content-Disposition',
        contentDisposition(inline ? 'inline' : 'attachment', a.originalName),
      );
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      );
      return new Promise<void>((resolve, reject) => {
        const stream = fs.createReadStream(file);
        stream.on('error', reject);
        stream.on('end', () => resolve());
        stream.pipe(res);
      });
    },
  });

  defineRoute(router, p, {
    method: 'delete',
    path: '/:id',
    tag: 'Attachments',
    summary: 'Delete an attachment',
    params: idParam,
    status: 204,
    handler: ({ auth, params }) => deleteAttachment(ctx, auth.user.id, params.id),
  });

  return router;
}
