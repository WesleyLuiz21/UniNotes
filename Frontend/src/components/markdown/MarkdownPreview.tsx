import { lazy, memo, Suspense, type ComponentProps } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkEmoji from 'remark-emoji';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CodeBlock } from './CodeBlock';
import { isAttachmentUrl, isExternalUrl, safeUrl, sanitizeSchema } from './sanitize';

const MermaidBlock = lazy(() => import('./MermaidBlock').then((m) => ({ default: m.MermaidBlock })));

type ElementProps<T extends keyof React.JSX.IntrinsicElements> = ComponentProps<T> & { node?: unknown };

function textOf(children: unknown): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(textOf).join('');
  if (children && typeof children === 'object' && 'props' in children)
    return textOf((children as { props: { children?: unknown } }).props.children);
  return '';
}

const components: Components = {
  pre({ children }: ElementProps<'pre'>) {
    const child = Array.isArray(children) ? children[0] : children;
    const props = (child as { props?: { className?: string; children?: unknown } } | undefined)?.props ?? {};
    const lang = /language-([\w+#.-]+)/.exec(props.className ?? '')?.[1] ?? '';
    const code = textOf(props.children).replace(/\n$/, '');
    if (lang === 'mermaid') {
      return (
        <Suspense fallback={<div className="mermaid-block bg-elevated h-24 animate-pulse rounded" />}>
          <MermaidBlock code={code} />
        </Suspense>
      );
    }
    return <CodeBlock code={code} lang={lang} />;
  },
  a({ href = '', children, node: _n, ...rest }: ElementProps<'a'>) {
    if (!href) return <span>{children}</span>;
    const external = isExternalUrl(href);
    return (
      <a
        href={href}
        {...rest}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
      >
        {children}
      </a>
    );
  },
  img({ src = '', alt = '', node: _n, ...rest }: ElementProps<'img'>) {
    const url = typeof src === 'string' ? src : '';
    // Only same-origin attachments and inline raster images are displayed. Remote images are not
    // fetched (privacy: no tracking pixels; also blocked by CSP) and are shown as a link instead.
    if (!url || (!isAttachmentUrl(url) && !url.startsWith('data:image/'))) {
      return (
        <span className="border-border text-muted-foreground inline-flex items-center gap-1.5 rounded border border-dashed px-2 py-1 text-xs">
          <ImageOff className="size-3.5" aria-hidden />
          {url && /^https?:/i.test(url) ? (
            <a href={url} target="_blank" rel="noopener noreferrer nofollow">
              External image{alt ? `: ${alt}` : ''}
            </a>
          ) : (
            `Image unavailable${alt ? `: ${alt}` : ''}`
          )}
        </span>
      );
    }
    return <img src={url} alt={alt} loading="lazy" decoding="async" {...rest} />;
  },
  table({ children, node: _n, ...rest }: ElementProps<'table'>) {
    return (
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Table">
        <table {...rest}>{children}</table>
      </div>
    );
  },
};

const remarkPlugins = [remarkGfm, remarkMath, [remarkEmoji, { accessible: true }]] as ComponentProps<
  typeof ReactMarkdown
>['remarkPlugins'];
const rehypePlugins = [
  [rehypeSanitize, sanitizeSchema],
  // KaTeX runs after sanitisation on math nodes only; trust:false blocks \href, \url, \htmlClass etc.
  [rehypeKatex, { throwOnError: false, trust: false, strict: 'ignore', maxSize: 50, maxExpand: 500 }],
] as ComponentProps<typeof ReactMarkdown>['rehypePlugins'];

function MarkdownPreviewImpl({ markdown, className }: { markdown: string; className?: string }) {
  return (
    <div className={cn('markdown-body', className)}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
        urlTransform={safeUrl}
        skipHtml
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

const MarkdownPreview = memo(MarkdownPreviewImpl);
export default MarkdownPreview;
export { MarkdownPreview };
