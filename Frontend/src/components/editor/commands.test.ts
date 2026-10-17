import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { formatting } from './commands';

function view(doc: string, from: number, to = from) {
  return new EditorView({
    state: EditorState.create({ doc, selection: EditorSelection.single(from, to) }),
    parent: document.body,
  });
}

describe('editor formatting commands', () => {
  it('wraps and unwraps bold', () => {
    const v = view('hello world', 0, 5);
    formatting.bold(v);
    expect(v.state.doc.toString()).toBe('**hello** world');
    formatting.bold(v);
    expect(v.state.doc.toString()).toBe('hello world');
  });

  it('inserts a placeholder when nothing is selected', () => {
    const v = view('', 0);
    formatting.italic(v);
    expect(v.state.doc.toString()).toBe('_italic text_');
    const sel = v.state.selection.main;
    expect(v.state.sliceDoc(sel.from, sel.to)).toBe('italic text');
  });

  it('toggles headings and replaces existing markers', () => {
    const v = view('Title', 2);
    formatting.h2(v);
    expect(v.state.doc.toString()).toBe('## Title');
    formatting.h1(v);
    expect(v.state.doc.toString()).toBe('# Title');
    formatting.h1(v);
    expect(v.state.doc.toString()).toBe('Title');
  });

  it('numbers list items across a multi-line selection', () => {
    const v = view('a\nb\nc', 0, 5);
    formatting.numbered(v);
    expect(v.state.doc.toString()).toBe('1. a\n2. b\n3. c');
  });

  it('creates task items and links', () => {
    const v = view('todo', 0);
    formatting.task(v);
    expect(v.state.doc.toString()).toBe('- [ ] todo');
    const l = view('docs', 0, 4);
    formatting.link(l);
    expect(l.state.doc.toString()).toBe('[docs](https://)');
  });

  it('inserts blocks on their own line', () => {
    const v = view('text', 4);
    formatting.codeBlock(v);
    expect(v.state.doc.toString()).toBe('text\n\n```\ncode\n```\n');
  });
});
