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
const MAX_INPUT_PIXELS = 40_000_000; // decompression-bomb guard
// Keep libvips memory bounded: no operation cache, one image at a time per call.
sharp.cache(false);
sharp.concurrency(1);

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

// Source code is stored byte-for-byte and only ever served as a text/plain download.
export const SOURCE_EXTENSIONS = new Set(['.c', '.h', '.py', '.js', '.ts', '.html']);
export const MAX_SOURCE_BYTES = 1024 * 1024;
const SOURCE_MIME = 'text/plain';

/** A validated, processed upload ready to be written to storage. */
export interface PreparedFile {
  kind: Attachment['kind'];
  mimeType: string;
  data: Buffer;
  width: number | null;
  height: number | null;
  originalName: string;
}

/** Non-empty, no NUL bytes and strictly valid UTF-8, so renamed binaries are never accepted. */
function isSourceText(buffer: Buffer): boolean {
  if (buffer.length === 0 || buffer.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate and process an upload without storing it.
 * Images: real content type is sniffed from the bytes (the client MIME type and extension are
 * ignored), then the image is decoded and re-encoded with sharp, which drops metadata (EXIF/GPS)
 * and any trailing payloads. PDFs: magic bytes are checked. Source code (.c .h .py .js .ts .html):
 * must be plain UTF-8 text, kept byte-for-byte. PDFs and source files are only ever served as
 * downloads. Everything else is rejected.
 */
export async function prepareUpload(
  ctx: AppContext,
  file: { buffer: Buffer; originalname: string },
): Promise<PreparedFile> {
  const detected = await fileTypeFromBuffer(file.buffer);
  const originalName = sanitizeOriginalName(file.originalname, 'upload');
  const sourceExt = path.extname(originalName).toLowerCase();

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
  } else if (SOURCE_EXTENSIONS.has(sourceExt) && !detected) {
    // !detected: no recognisable binary signature (executables, archives, images renamed to .c).
    if (file.buffer.length > MAX_SOURCE_BYTES) throw tooLarge('Source file is too large (max 1 MB)');
    if (!isSourceText(file.buffer)) {
      throw unsupported('Source files must be non-empty UTF-8 text');
    }
    kind = 'file';
    mimeType = SOURCE_MIME;
    data = file.buffer;
  } else {
    throw unsupported(
      'Unsupported file type. Allowed: PNG, JPEG, WebP images, PDF documents and source code (.c .h .py .js .ts .html).',
    );
  }

  let displayName = originalName;
  if (mimeType !== SOURCE_MIME) {
    const ext =
      kind === 'image'
        ? `.${IMAGE_TYPES.get(mimeType as never) === 'jpeg' ? 'jpg' : IMAGE_TYPES.get(mimeType as never)}`
        : '.pdf';
    if (path.extname(originalName).toLowerCase() !== ext)
      displayName = `${path.parse(originalName).name || 'upload'}${ext}`;
  }
  return { kind, mimeType, data, width, height, originalName: displayName };
}

/** Write prepared bytes under a new opaque storage key; returns the key. */
export function writeStoredFile(ctx: AppContext, data: Buffer): string {
  const storageKey = randomToken(24);
  fs.mkdirSync(ctx.config.paths.attachments, { recursive: true });
  writeAtomic(storagePath(ctx, storageKey), data);
  return storageKey;
}

/** Build the attachments row for a prepared file that has been written under storageKey. */
export function attachmentRow(
  userId: string,
  noteId: string,
  prepared: PreparedFile,
  storageKey: string,
  id: string = newId(),
): Attachment {
  return {
    id,
    userId,
    noteId,
    kind: prepared.kind,
    mimeType: prepared.mimeType,
    sizeBytes: prepared.data.length,
    originalName: prepared.originalName,
    storageKey,
    sha256: sha256Hex(prepared.data),
    width: prepared.width,
    height: prepared.height,
    createdAt: nowIso(),
  };
}

/** Validate and store an upload for a note. */
export async function storeUpload(
  ctx: AppContext,
  userId: string,
  noteId: string,
  file: { buffer: Buffer; originalname: string },
) {
  getOwnedNote(ctx.db, userId, noteId);
  const prepared = await prepareUpload(ctx, file);
  const storageKey = writeStoredFile(ctx, prepared.data);
  const row = attachmentRow(userId, noteId, prepared, storageKey);
  try {
    ctx.db.insert(attachments).values(row).run();
  } catch (err) {
    fs.rmSync(storagePath(ctx, storageKey), { force: true });
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
