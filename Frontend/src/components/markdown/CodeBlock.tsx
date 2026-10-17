import { useEffect, useState, type ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { Check, Copy } from 'lucide-react';
import { getHighlighter, resolveLang } from './highlighter';

export function CopyButton({ text, label = 'Copy code' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="border-border bg-surface text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs opacity-100 transition-opacity focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
      aria-label={copied ? 'Copied' : label}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/**
 * Fenced code block with lazy Shiki highlighting. Shiki's output is a HAST tree that is converted
 * to React elements (never injected as an HTML string), so code content is always escaped.
 */
export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [highlighted, setHighlighted] = useState<ReactNode>(null);
  const resolved = resolveLang(lang);

  useEffect(() => {
    if (!resolved) return;
    let cancelled = false;
    getHighlighter(resolved)
      .then((h) => {
        if (cancelled) return;
        const hast = h.codeToHast(code, {
          lang: resolved,
          themes: { light: 'github-light', dark: 'github-dark' },
          defaultColor: false,
        });
        setHighlighted(toJsxRuntime(hast, { Fragment, jsx, jsxs }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [code, resolved]);

  return (
    <div className="code-block group relative">
      <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
        {lang && <span className="text-muted-foreground text-[11px] uppercase select-none">{lang}</span>}
        <CopyButton text={code} />
      </div>
      {highlighted ?? (
        <pre>
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
