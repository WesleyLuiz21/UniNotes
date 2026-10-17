import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import type { AppContext } from '../context.js';
import { attachments, type Attachment } from '../db/schema.js';
import { newId, randomToken, sha256Hex } from '../lib/crypto.js';
import { notFound, tooLarge, unsupported } from '../lib/errors.js';
import { sanitizeOriginalName } from '../lib/filenames.js';
import { nowIso } from '../lib/time.js';
import { getOwnedNote } from './notes.service.js';

const IMAGE_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpeg'],
  ['image/webp', 'webp'],
] as const);
const MAX_IMAGE_DIMENSION = 4096;
const MAX_INPUT_PIXELS = 60_000_000; // decompression-bomb guard

export const attachmentUrl = (id: string) => `/api/attachments/${id}/content`;

export function serializeAttachment(a: Attachment) {
  return {
    id: a.id,
    noteId: a.noteId,
    kind: a.kind,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    originalName: a.originalName,
    width: a.width,
    height: a.height,
    createdAt: a.createdAt,
    url: attachmentUrl(a.id),
  };
}

/** Resolve a storage key to a path that is guaranteed to be inside the attachments directory. */
export function storagePath(ctx: AppContext, storageKey: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(storageKey)) throw new Error('Invalid storage key');
  const root = path.resolve(ctx.config.paths.attachments);
  const full = path.resolve(root, storageKey);
  if (path.dirname(full) !== root) throw new Error('Path traversal blocked');
  return full;
}

/** Write via temp file + rename so a crash never leaves a half-written attachment. */
function writeAtomic(file: string, data: Buffer) {
  const tmp = `${file}.tmp-${randomToken(6)}`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * Validate and store an upload for a note.
 * Images: real content type is sniffed from the bytes (the client MIME type and extension are
 * ignored), then the image is decoded and re-encoded with sharp, which drops metadata (EXIF/GPS)
 * and any trailing payloads. PDFs: magic bytes are checked; they are only ever served as
 * downloads. Everything else is rejected.
 */
export async function storeUpload(
  ctx: AppContext,
  userId: string,
  noteId: string,
  file: { buffer: Buffer; originalname: string },
) {
  getOwnedNote(ctx.db, userId, noteId);
  const detected = await fileTypeFromBuffer(file.buffer);
  const originalName = sanitizeOriginalName(file.originalname, 'upload');

  let kind: Attachment['kind'];
  let mimeType: string;
  let data: Buffer;
  let width: number | null = null;
  let height: number | null = null;

  if (detected && IMAGE_TYPES.has(detected.mime as never)) {
    if (file.buffer.length > ctx.config.limits.imageBytes) throw tooLarge('Image is too large');
    const format = IMAGE_TYPES.get(detected.mime as never)!;
    try {
      const pipeline = sharp(file.buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
        .rotate() // apply EXIF orientation before metadata is stripped
        .resize({
          width: MAX_IMAGE_DIMENSION,
          height: MAX_IMAGE_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
        });
      const out =
        format === 'png'
          ? pipeline.png({ compressionLevel: 9 })
          : format === 'jpeg'
            ? pipeline.jpeg({ quality: 88, mozjpeg: true })
            : pipeline.webp({ quality: 88 });
      const { data: encoded, info } = await out.toBuffer({ resolveWithObject: true });
      data = encoded;
      width = info.width;
      height = info.height;
    } catch {
      throw unsupported('The image could not be processed. Use a valid PNG, JPEG or WebP file.');
    }
    kind = 'image';
    mimeType = detected.mime;
  } else if (
    detected?.mime === 'application/pdf' &&
    file.buffer.subarray(0, 5).toString('latin1') === '%PDF-'
  ) {
    if (file.buffer.length > ctx.config.limits.attachmentBytes) throw tooLarge('File is too large');
    kind = 'file';
    mimeType = 'application/pdf';
    data = file.buffer;
  } else {
    throw unsupported('Unsupported file type. Allowed: PNG, JPEG, WebP images and PDF documents.');
  }

  const id = newId();
  const storageKey = randomToken(24);
  fs.mkdirSync(ctx.config.paths.attachments, { recursive: true });
  const target = storagePath(ctx, storageKey);
  writeAtomic(target, data);
  const ext =
    kind === 'image'
      ? `.${IMAGE_TYPES.get(mimeType as never) === 'jpeg' ? 'jpg' : IMAGE_TYPES.get(mimeType as never)}`
      : '.pdf';
  const displayName =
    path.extname(originalName).toLowerCase() === ext
      ? originalName
      : `${path.parse(originalName).name || 'upload'}${ext}`;
  const row = {
    id,
    userId,
    noteId,
    kind,
    mimeType,
    sizeBytes: data.length,
    originalName: displayName,
    storageKey,
    sha256: sha256Hex(data),
    width,
    height,
    createdAt: nowIso(),
  };
  try {
    ctx.db.insert(attachments).values(row).run();
  } catch (err) {
    fs.rmSync(target, { force: true });
    throw err;
  }
  return serializeAttachment(row);
}

export function getOwnedAttachment(ctx: AppContext, userId: string, id: string): Attachment {
  const a = ctx.db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.userId, userId)))
    .get();
  if (!a) throw notFound('Attachment');
  return a;
}

export function listNoteAttachments(ctx: AppContext, userId: string, noteId: string) {
  getOwnedNote(ctx.db, userId, noteId, { includeDeleted: true });
  return ctx.db
    .select()
    .from(attachments)
    .where(and(eq(attachments.noteId, noteId), eq(attachments.userId, userId)))
    .orderBy(attachments.createdAt)
    .all()
    .map(serializeAttachment);
}

export function deleteAttachment(ctx: AppContext, userId: string, id: string) {
  const a = getOwnedAttachment(ctx, userId, id);
  ctx.db.delete(attachments).where(eq(attachments.id, a.id)).run();
  fs.rmSync(storagePath(ctx, a.storageKey), { force: true });
}

/** Extract UniNotes attachment ids referenced from Markdown (images and links). */
export function referencedAttachmentIds(markdown: string): string[] {
  const re = /\/api\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/content/gi;
  return [...new Set([...markdown.matchAll(re)].map((m) => m[1]!.toLowerCase()))];
}
