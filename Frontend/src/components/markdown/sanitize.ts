import { defaultSchema } from 'rehype-sanitize';
import type { Options as SanitizeSchema } from 'rehype-sanitize';

/**
 * Sanitisation schema (GitHub's allow-list, tightened).
 * Raw HTML in Markdown is never parsed (no rehype-raw), and the rendered tree is sanitised before
 * KaTeX runs, so only Markdown-generated elements with allow-listed attributes survive.
 */
export const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // Keep language-* classes for highlighting and math-* classes for rehype-katex.
    code: [['className', /^language-[\w+#.-]+$/, 'math-inline', 'math-display']],
  },
  protocols: {
    href: ['http', 'https', 'mailto'],
    src: ['http', 'https'],
    cite: ['http', 'https'],
  },
};

const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i;

/**
 * URL policy for links and images. Relative URLs, http(s) and mailto are allowed for links;
 * images may additionally be inline raster data URIs. Everything else (javascript:, vbscript:,
 * data:text/html, file:, …) is dropped.
 */
export function safeUrl(url: string, key: string): string {
  const value = url.trim();
  if (key === 'src' && SAFE_DATA_IMAGE.test(value)) return value;
  // Strip control/whitespace characters browsers ignore when parsing schemes (e.g. "java\tscript:").
  // eslint-disable-next-line no-control-regex
  const normalized = value.replace(/[\u0000- \u007f]/g, '').toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(normalized)?.[1];
  if (!scheme) return value; // relative URL or fragment
  if (scheme === 'http' || scheme === 'https') return value;
  if (scheme === 'mailto' && key === 'href') return value;
  return '';
}

export const isAttachmentUrl = (src: string) =>
  /^\/api\/attachments\/[0-9a-f-]{36}\/content(\?.*)?$/i.test(src);
export const isExternalUrl = (href: string) =>
  /^https?:\/\//i.test(href) && !href.startsWith(window.location.origin);
