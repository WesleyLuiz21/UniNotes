import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { useTags } from '@/api/misc';
import { cn } from '@/lib/utils';

const TAG_RE = /^[\p{L}\p{N}][\p{L}\p{N}_\-/.]*$/u;
export const normaliseTag = (t: string) =>
  t.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-').slice(0, 40);

export function TagInput({
  value,
  onChange,
  id,
  className,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  id?: string;
  className?: string;
}) {
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const { data: all } = useTags();
  const listId = useId();
  const inputId = id ?? `${listId}-input`;

  const add = (raw: string) => {
    const tag = normaliseTag(raw);
    if (!tag) return;
    if (!TAG_RE.test(tag)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (!value.includes(tag) && value.length < 25) onChange([...value, tag]);
    setText('');
  };

  return (
    <div
      className={cn(
        'border-input bg-surface focus-within:outline-ring flex min-h-9 flex-wrap items-center gap-1 rounded-md border px-2 py-1 focus-within:outline-2',
        invalid && 'border-danger',
        className,
      )}
    >
      {value.map((t) => (
        <span key={t} className="bg-elevated inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs">
          #{t}
          <button
            type="button"
            onClick={() => onChange(value.filter((x) => x !== t))}
            className="text-muted-foreground hover:text-foreground rounded p-0.5"
            aria-label={`Remove tag ${t}`}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={inputId}
        value={text}
        list={listId}
        onChange={(e) => {
          setInvalid(false);
          const v = e.target.value;
          if (v.endsWith(',')) add(v.slice(0, -1));
          else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(text);
          } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => text && add(text)}
        placeholder={value.length ? '' : 'Add tags…'}
        className="placeholder:text-muted-foreground min-w-20 flex-1 bg-transparent text-sm outline-none"
        aria-label="Add tag"
        aria-invalid={invalid}
      />
      <datalist id={listId}>
        {all
          ?.filter((t) => !value.includes(t.name))
          .map((t) => (
            <option key={t.name} value={t.name} />
          ))}
      </datalist>
    </div>
  );
}
