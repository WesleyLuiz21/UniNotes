import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Dialog as D } from 'radix-ui';
import { ArrowRight, FileText, Search } from 'lucide-react';
import { useSearch } from '@/api/notes';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/misc';
import { Highlight } from '@/components/notes/Highlight';
import { useDebouncedValue } from '@/hooks/useDebounce';
import { formatLectureDate } from '@/lib/dates';
import { cn } from '@/lib/utils';

export function QuickSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebouncedValue(q.trim(), 200);
  const navigate = useNavigate();
  const { data, isFetching } = useSearch(
    { q: debounced, pageSize: 8, status: 'all' },
    open && debounced.length > 0,
  );
  const items = debounced ? (data?.items ?? []) : [];
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);
  useEffect(() => setActive(0), [debounced]);

  const go = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };
  const total = items.length + (debounced ? 1 : 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        hideClose
        className="top-[15%] translate-y-0 gap-0 p-0 sm:p-0"
        aria-describedby={undefined}
      >
        <D.Title className="sr-only">Search notes</D.Title>
        <div className="border-border flex items-center gap-2 border-b px-4">
          <Search className="text-muted-foreground size-4" aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, total - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter' && debounced) {
                e.preventDefault();
                const item = items[active];
                go(item ? `/notes/${item.id}` : `/search?q=${encodeURIComponent(debounced)}`);
              }
            }}
            placeholder="Search titles, content, tags, modules…"
            className="placeholder:text-muted-foreground h-12 flex-1 bg-transparent text-[15px] outline-none"
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls="quick-search-results"
            aria-activedescendant={total ? `qs-item-${active}` : undefined}
            aria-label="Search notes"
          />
          {isFetching && <Spinner className="text-muted-foreground" />}
        </div>
        <ul
          id="quick-search-results"
          role="listbox"
          ref={listRef}
          className="max-h-[60vh] overflow-y-auto p-2"
        >
          {!debounced && (
            <li className="text-muted-foreground px-3 py-6 text-center text-sm">
              Type to search your notes.
            </li>
          )}
          {debounced && !isFetching && items.length === 0 && (
            <li className="text-muted-foreground px-3 py-6 text-center text-sm">
              No notes match “{debounced}”.
            </li>
          )}
          {items.map((n, i) => (
            <li
              key={n.id}
              id={`qs-item-${i}`}
              role="option"
              aria-selected={active === i}
              onMouseMove={() => setActive(i)}
              onClick={() => go(`/notes/${n.id}`)}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-md px-3 py-2',
                active === i && 'bg-hover',
              )}
            >
              <FileText className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Highlight text={n.titleHighlight ?? n.title} className="truncate text-sm font-medium" />
                  {n.module && (
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: n.module.color }}
                      aria-hidden
                    />
                  )}
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                    {formatLectureDate(n.lectureDate)}
                  </span>
                </div>
                {n.snippet && (
                  <Highlight text={n.snippet} className="text-muted-foreground line-clamp-1 text-xs" />
                )}
              </div>
            </li>
          ))}
          {debounced && (
            <li
              id={`qs-item-${items.length}`}
              role="option"
              aria-selected={active === items.length}
              onMouseMove={() => setActive(items.length)}
              onClick={() => go(`/search?q=${encodeURIComponent(debounced)}`)}
              className={cn(
                'text-accent flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm',
                active === items.length && 'bg-hover',
              )}
            >
              <ArrowRight className="size-4" aria-hidden /> See all results with filters
            </li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
