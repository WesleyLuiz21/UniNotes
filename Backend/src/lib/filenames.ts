import path from 'node:path';

/**
 * Produce a filesystem-safe, predictable slug suitable for export file names.
 * Only [a-z0-9-] survive; never returns an empty string, "." or "..".
 */
export function slugify(input: string, fallback = 'untitled', maxLength = 80): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || fallback;
}

/**
 * Clean a user-supplied original file name for display and Content-Disposition.
 * Strips directories, control characters and reserved characters; keeps the extension.
 */
export function sanitizeOriginalName(name: string, fallback = 'file'): string {
  const base = path.posix.basename(path.win32.basename(name || ''));
  const cleaned = base
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 150);
  return cleaned || fallback;
}

/** Name for an exported asset, unique via the attachment id prefix. */
export function exportAssetName(id: string, originalName: string): string {
  const safe = sanitizeOriginalName(originalName);
  const ext = path
    .extname(safe)
    .toLowerCase()
    .replace(/[^.a-z0-9]/g, '');
  const stem = slugify(safe.slice(0, safe.length - path.extname(safe).length), 'asset', 50);
  return `${id.slice(0, 8)}-${stem}${ext}`;
}

/** RFC 6266 Content-Disposition with an ASCII fallback and UTF-8 filename*. */
export function contentDisposition(type: 'attachment' | 'inline', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
