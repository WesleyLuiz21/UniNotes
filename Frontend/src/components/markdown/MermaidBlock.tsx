import { useEffect, useId, useState } from 'react';
import { useTheme } from '@/lib/theme';
import { CopyButton } from './CodeBlock';

let queue: Promise<unknown> = Promise.resolve();

/**
 * Mermaid diagrams. Mermaid runs with securityLevel "strict" (labels sanitised, no click
 * handlers) and HTML labels disabled. The resulting SVG is displayed through an <img> data URI,
 * a context in which browsers never execute scripts or load external resources — so even a
 * hypothetical Mermaid sanitiser bypass cannot run code in the app.
 */
export function MermaidBlock({ code }: { code: string }) {
  const { resolved } = useTheme();
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Mermaid rendering is serialised; its global config is shared.
    queue = queue.then(async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: resolved === 'dark' ? 'dark' : 'default',
          htmlLabels: false,
          flowchart: { htmlLabels: false },
          fontFamily: 'Inter Variable, ui-sans-serif, system-ui, sans-serif',
        });
        const { svg } = await mermaid.render(`mmd-${id}-${Date.now()}`, code);
        if (!cancelled) {
          setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message.split('\n')[0]! : 'Invalid diagram');
        document.getElementById(`dmmd-${id}`)?.remove();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code, resolved, id]);

  if (error) {
    return (
      <div className="mermaid-block border-danger/40 bg-danger/5 rounded-md border p-3 text-sm">
        <p className="text-danger font-medium">Diagram error</p>
        <p className="text-muted-foreground mt-1">{error}</p>
        <pre className="mt-2 text-xs">
          <code>{code}</code>
        </pre>
      </div>
    );
  }
  return (
    <figure className="mermaid-block group border-border bg-surface relative overflow-x-auto rounded-md border p-3">
      <div className="absolute top-2 right-2">
        <CopyButton text={code} label="Copy diagram source" />
      </div>
      {src ? (
        <img src={src} alt="Mermaid diagram" className="mx-auto max-w-full border-0" />
      ) : (
        <div className="bg-elevated h-24 animate-pulse rounded" />
      )}
    </figure>
  );
}
