import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  placeholder as cmPlaceholder,
  dropCursor,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { HighlightStyle, syntaxHighlighting, bracketMatching, indentOnInput } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { formatting, type FormatCommand } from './commands';

export interface MarkdownEditorHandle {
  run: (cmd: FormatCommand) => void;
  insert: (text: string) => void;
  setValue: (text: string) => void;
  focus: () => void;
  /** Insert a placeholder at the cursor and return a function that replaces it. */
  placeholderAtCursor: (text: string) => (replacement: string) => void;
}

interface Props {
  initialValue: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  onFiles?: (files: File[], insertAt: (text: string) => (replacement: string) => void) => void;
  fontSize?: number;
  lineWrap?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}

// Colours come from CSS variables so the editor follows the app theme without reconfiguring.
const theme = EditorView.theme({
  '&': { color: 'var(--foreground)', backgroundColor: 'transparent', height: '100%' },
  '.cm-content': { padding: '1rem 0', caretColor: 'var(--accent)', maxWidth: '52rem', margin: '0 auto' },
  '.cm-line': { padding: '0 1.25rem' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--selection) !important',
  },
  '.cm-activeLine': { backgroundColor: 'var(--hover)' },
  '.cm-placeholder': { color: 'var(--muted-foreground)' },
  '.cm-searchMatch': { backgroundColor: 'var(--mark)' },
  '.cm-panels': {
    backgroundColor: 'var(--elevated)',
    color: 'var(--foreground)',
    borderColor: 'var(--border)',
  },
  '.cm-panels input, .cm-panels button': { color: 'var(--foreground)' },
  '.cm-textfield': {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--input)',
    borderRadius: '4px',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--input)',
    borderRadius: '4px',
  },
});

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontWeight: '700', fontSize: '1.35em' },
  { tag: t.heading2, fontWeight: '700', fontSize: '1.2em' },
  { tag: t.heading3, fontWeight: '650', fontSize: '1.1em' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '650' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--accent)' },
  { tag: t.monospace, color: 'var(--warning)' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--muted-foreground)' },
  { tag: t.quote, color: 'var(--muted-foreground)', fontStyle: 'italic' },
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword], color: '#c678dd' },
  { tag: [t.string, t.special(t.string)], color: 'var(--success)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--warning)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--muted-foreground)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--accent)' },
]);

const formatKeymap = keymap.of([
  { key: 'Mod-b', run: formatting.bold },
  { key: 'Mod-i', run: formatting.italic },
  { key: 'Mod-Shift-k', run: formatting.link },
  { key: 'Mod-e', run: formatting.code },
  { key: 'Mod-Shift-x', run: formatting.strike },
  { key: 'Mod-Alt-1', run: formatting.h1 },
  { key: 'Mod-Alt-2', run: formatting.h2 },
  { key: 'Mod-Alt-3', run: formatting.h3 },
  { key: 'Mod-Shift-7', run: formatting.numbered },
  { key: 'Mod-Shift-8', run: formatting.bullet },
  { key: 'Mod-Shift-9', run: formatting.task },
  { key: 'Mod-Alt-c', run: formatting.codeBlock },
  { key: 'Mod-Alt-m', run: formatting.math },
]);

function imageFiles(list: FileList | null | undefined) {
  return Array.from(list ?? []).filter(
    (f) => /^image\/(png|jpeg|webp)$/.test(f.type) || f.type === 'application/pdf',
  );
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(function MarkdownEditor(
  {
    initialValue,
    onChange,
    onSave,
    onFiles,
    fontSize = 14,
    lineWrap = true,
    placeholder = 'Start writing…',
    ariaLabel = 'Note content (Markdown)',
  },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const wrapCompartment = useRef(new Compartment());
  const callbacks = useRef({ onChange, onSave, onFiles });
  useEffect(() => {
    callbacks.current = { onChange, onSave, onFiles };
  });

  const placeholderAt = (view: EditorView, pos: number, text: string) => {
    view.dispatch({ changes: { from: pos, insert: text }, userEvent: 'input' });
    let start = pos;
    return (replacement: string) => {
      // Locate the placeholder again (the document may have changed during the upload).
      const doc = view.state.doc.toString();
      const idx = doc.indexOf(text, Math.max(0, start - 2000));
      const at = idx === -1 ? doc.indexOf(text) : idx;
      if (at === -1) return;
      view.dispatch({ changes: { from: at, to: at + text.length, insert: replacement }, userEvent: 'input' });
      start = at;
    };
  };

  useEffect(() => {
    const extensions: Extension[] = [
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      syntaxHighlighting(highlight),
      theme,
      wrapCompartment.current.of(lineWrap ? EditorView.lineWrapping : []),
      cmPlaceholder(placeholder),
      EditorView.contentAttributes.of({
        'aria-label': ariaLabel,
        'aria-multiline': 'true',
        spellcheck: 'true',
        autocorrect: 'on',
        autocapitalize: 'sentences',
      }),
      formatKeymap,
      keymap.of([
        { key: 'Mod-s', run: () => (callbacks.current.onSave?.(), true), preventDefault: true },
        ...searchKeymap,
        ...historyKeymap,
        ...defaultKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) callbacks.current.onChange(u.state.doc.toString());
      }),
      EditorView.domEventHandlers({
        paste(event, view) {
          const files = imageFiles(event.clipboardData?.files);
          if (!files.length || !callbacks.current.onFiles) return false;
          event.preventDefault();
          const pos = view.state.selection.main.head;
          let offset = pos;
          callbacks.current.onFiles(files, (text) => {
            const replace = placeholderAt(view, offset, text);
            offset += text.length;
            return replace;
          });
          return true;
        },
        drop(event, view) {
          const files = imageFiles(event.dataTransfer?.files);
          if (!files.length || !callbacks.current.onFiles) return false;
          event.preventDefault();
          const pos =
            view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
          let offset = pos;
          callbacks.current.onFiles(files, (text) => {
            const replace = placeholderAt(view, offset, text);
            offset += text.length;
            return replace;
          });
          return true;
        },
      }),
    ];
    const view = new EditorView({
      state: EditorState.create({ doc: initialValue, extensions }),
      parent: host.current!,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once; later value changes go through setValue().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapCompartment.current.reconfigure(lineWrap ? EditorView.lineWrapping : []),
    });
  }, [lineWrap]);

  useImperativeHandle(ref, () => ({
    run: (cmd) => {
      if (viewRef.current) formatting[cmd](viewRef.current);
    },
    insert: (text) => {
      const v = viewRef.current;
      if (!v) return;
      const { from, to } = v.state.selection.main;
      v.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        scrollIntoView: true,
        userEvent: 'input',
      });
      v.focus();
    },
    setValue: (text) => {
      const v = viewRef.current;
      if (!v || v.state.doc.toString() === text) return;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
    },
    focus: () => viewRef.current?.focus(),
    placeholderAtCursor: (text) => {
      const v = viewRef.current!;
      return placeholderAt(v, v.state.selection.main.head, text);
    },
  }));

  return (
    <div
      ref={host}
      className="h-full min-h-0 overflow-hidden"
      style={{ ['--editor-font-size' as string]: `${fontSize}px` }}
      data-testid="markdown-editor"
    />
  );
});
