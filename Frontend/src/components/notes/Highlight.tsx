import { Fragment } from 'react';

const START = '\u0001';
const END = '\u0002';

/**
 * Render a server search snippet. The server marks matches with control characters instead of
 * HTML, and we turn them into <mark> elements — text is never interpreted as markup.
 */
export function Highlight({ text, className }: { text: string; className?: string }) {
  const parts: { text: string; hit: boolean }[] = [];
  let rest = text;
  while (rest.length) {
    const s = rest.indexOf(START);
    if (s === -1) {
      parts.push({ text: rest, hit: false });
      break;
    }
    if (s > 0) parts.push({ text: rest.slice(0, s), hit: false });
    const e = rest.indexOf(END, s + 1);
    const end = e === -1 ? rest.length : e;
    parts.push({ text: rest.slice(s + 1, end), hit: true });
    rest = e === -1 ? '' : rest.slice(e + 1);
  }
  return (
    <span className={className}>
      {parts.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <Fragment key={i}>{p.text}</Fragment>))}
    </span>
  );
}

/** Strip markers (for plain-text contexts such as aria labels). */
export const stripMarks = (text: string) => text.replaceAll(START, '').replaceAll(END, '');
