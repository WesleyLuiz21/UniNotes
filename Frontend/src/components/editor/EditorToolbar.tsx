import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Sigma,
  SquareCode,
  Strikethrough,
  Table,
  Workflow,
} from 'lucide-react';
import { Tooltip } from '@/components/ui/misc';
import { modKey } from '@/lib/utils';
import type { FormatCommand } from './commands';

type Item = { cmd: FormatCommand; label: string; icon: typeof Bold; shortcut?: string } | 'sep';

const ITEMS: Item[] = [
  { cmd: 'h1', label: 'Heading 1', icon: Heading1, shortcut: `${modKey}+Alt+1` },
  { cmd: 'h2', label: 'Heading 2', icon: Heading2, shortcut: `${modKey}+Alt+2` },
  { cmd: 'h3', label: 'Heading 3', icon: Heading3, shortcut: `${modKey}+Alt+3` },
  'sep',
  { cmd: 'bold', label: 'Bold', icon: Bold, shortcut: `${modKey}+B` },
  { cmd: 'italic', label: 'Italic', icon: Italic, shortcut: `${modKey}+I` },
  { cmd: 'strike', label: 'Strikethrough', icon: Strikethrough, shortcut: `${modKey}+Shift+X` },
  { cmd: 'code', label: 'Inline code', icon: Code, shortcut: `${modKey}+E` },
  { cmd: 'link', label: 'Link', icon: Link, shortcut: `${modKey}+Shift+K` },
  'sep',
  { cmd: 'bullet', label: 'Bulleted list', icon: List, shortcut: `${modKey}+Shift+8` },
  { cmd: 'numbered', label: 'Numbered list', icon: ListOrdered, shortcut: `${modKey}+Shift+7` },
  { cmd: 'task', label: 'Task list', icon: ListChecks, shortcut: `${modKey}+Shift+9` },
  { cmd: 'quote', label: 'Quote', icon: Quote },
  'sep',
  { cmd: 'codeBlock', label: 'Code block', icon: SquareCode, shortcut: `${modKey}+Alt+C` },
  { cmd: 'math', label: 'Inline maths', icon: Sigma, shortcut: `${modKey}+Alt+M` },
  { cmd: 'table', label: 'Table', icon: Table },
  { cmd: 'mermaid', label: 'Mermaid diagram', icon: Workflow },
  { cmd: 'hr', label: 'Horizontal rule', icon: Minus },
];

export function EditorToolbar({
  onCommand,
  onInsertImage,
}: {
  onCommand: (cmd: FormatCommand) => void;
  onInsertImage: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="border-border bg-surface flex [scrollbar-width:none] items-center gap-0.5 overflow-x-auto border-b px-2 py-1"
    >
      {ITEMS.map((item, i) =>
        item === 'sep' ? (
          <span key={i} className="bg-border mx-1 h-5 w-px shrink-0" aria-hidden />
        ) : (
          <Tooltip key={item.cmd} content={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}>
            <button
              type="button"
              // Keep focus in the editor so the command applies to the current selection.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onCommand(item.cmd)}
              className="text-muted-foreground hover:bg-hover hover:text-foreground grid size-8 shrink-0 place-items-center rounded-md"
              aria-label={item.label}
            >
              <item.icon className="size-4" />
            </button>
          </Tooltip>
        ),
      )}
      <span className="bg-border mx-1 h-5 w-px shrink-0" aria-hidden />
      <Tooltip content="Insert image or PDF (or paste / drop)">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onInsertImage}
          className="text-muted-foreground hover:bg-hover hover:text-foreground grid size-8 shrink-0 place-items-center rounded-md"
          aria-label="Insert image or PDF"
        >
          <ImagePlus className="size-4" />
        </button>
      </Tooltip>
    </div>
  );
}
