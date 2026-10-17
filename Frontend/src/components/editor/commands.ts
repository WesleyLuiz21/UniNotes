import { EditorSelection, type ChangeSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/** Wrap each selection in `before`/`after` (or unwrap if already wrapped). */
export function toggleWrap(view: EditorView, before: string, after = before, placeholder = 'text') {
  const { state } = view;
  view.dispatch(
    state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to);
      const outerFrom = range.from - before.length;
      const outerTo = range.to + after.length;
      if (
        outerFrom >= 0 &&
        state.sliceDoc(outerFrom, range.from) === before &&
        state.sliceDoc(range.to, outerTo) === after
      ) {
        return {
          changes: [
            { from: outerFrom, to: range.from, insert: '' },
            { from: range.to, to: outerTo, insert: '' },
          ],
          range: EditorSelection.range(outerFrom, range.to - before.length),
        };
      }
      const inner = text || placeholder;
      return {
        changes: { from: range.from, to: range.to, insert: before + inner + after },
        range: EditorSelection.range(range.from + before.length, range.from + before.length + inner.length),
      };
    }),
    { scrollIntoView: true, userEvent: 'input' },
  );
  view.focus();
  return true;
}

/** Toggle a prefix (e.g. "- ", "> ", "## ") on every line touched by the selection. */
export function toggleLinePrefix(
  view: EditorView,
  prefix: string | ((i: number) => string),
  pattern?: RegExp,
) {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  const seen = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    const lines = [];
    for (let n = first; n <= last; n++) if (!seen.has(n)) lines.push(state.doc.line(n));
    lines.forEach((l) => seen.add(l.number));
    const re = pattern ?? new RegExp(`^${escape(typeof prefix === 'string' ? prefix : prefix(0))}`);
    const allHave = lines.every((l) => re.test(l.text));
    lines.forEach((line, i) => {
      const m = re.exec(line.text);
      if (allHave && m) changes.push({ from: line.from, to: line.from + m[0].length, insert: '' });
      else {
        // Replace any existing heading/list marker so prefixes don't stack.
        const existing = /^(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+\. |> )/.exec(line.text);
        const insert = typeof prefix === 'string' ? prefix : prefix(i);
        changes.push({ from: line.from, to: line.from + (existing?.[0].length ?? 0), insert });
      }
    });
  }
  view.dispatch({ changes, scrollIntoView: true, userEvent: 'input' });
  view.focus();
  return true;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function insertText(view: EditorView, text: string, selectOffset?: [number, number]) {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: selectOffset
      ? EditorSelection.range(from + selectOffset[0], from + selectOffset[1])
      : EditorSelection.cursor(from + text.length),
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
  return true;
}

/** Insert a block on its own line(s). */
export function insertBlock(view: EditorView, block: string, cursorOffset?: [number, number]) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const needsNewlineBefore = line.text.trim().length > 0;
  const prefix = needsNewlineBefore ? '\n\n' : '';
  const pos = needsNewlineBefore ? line.to : line.from;
  const insert = `${prefix}${block}\n`;
  view.dispatch({
    changes: { from: pos, to: needsNewlineBefore ? pos : line.to, insert },
    selection: cursorOffset
      ? EditorSelection.range(pos + prefix.length + cursorOffset[0], pos + prefix.length + cursorOffset[1])
      : EditorSelection.cursor(pos + insert.length),
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
  return true;
}

export function insertLink(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to) || 'link text';
  const insert = `[${text}](https://)`;
  const urlStart = text.length + 3;
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.range(from + urlStart, from + urlStart + 8),
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
  return true;
}

export const formatting = {
  bold: (v: EditorView) => toggleWrap(v, '**', '**', 'bold text'),
  italic: (v: EditorView) => toggleWrap(v, '_', '_', 'italic text'),
  strike: (v: EditorView) => toggleWrap(v, '~~', '~~', 'text'),
  code: (v: EditorView) => toggleWrap(v, '`', '`', 'code'),
  math: (v: EditorView) => toggleWrap(v, '$', '$', 'x^2'),
  h1: (v: EditorView) => toggleLinePrefix(v, '# '),
  h2: (v: EditorView) => toggleLinePrefix(v, '## '),
  h3: (v: EditorView) => toggleLinePrefix(v, '### '),
  bullet: (v: EditorView) => toggleLinePrefix(v, '- ', /^[-*+] (?!\[[ xX]\] )/),
  numbered: (v: EditorView) => toggleLinePrefix(v, (i) => `${i + 1}. `, /^\d+\. /),
  task: (v: EditorView) => toggleLinePrefix(v, '- [ ] ', /^[-*+] \[[ xX]\] /),
  quote: (v: EditorView) => toggleLinePrefix(v, '> '),
  link: insertLink,
  codeBlock: (v: EditorView) => {
    const sel = v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to);
    return insertBlock(v, `\`\`\`\n${sel || 'code'}\n\`\`\``, sel ? undefined : [4, 8]);
  },
  mathBlock: (v: EditorView) => insertBlock(v, '$$\n\\int_a^b f(x)\\,dx\n$$', [3, 18]),
  table: (v: EditorView) =>
    insertBlock(v, '| Column 1 | Column 2 |\n| -------- | -------- |\n| Cell     | Cell     |', [2, 10]),
  hr: (v: EditorView) => insertBlock(v, '---'),
  mermaid: (v: EditorView) =>
    insertBlock(v, '```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```', [11, 23]),
};
export type FormatCommand = keyof typeof formatting;
