import { useEffect, useState } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import { useNotes, useSearch } from '@/api/notes';
import { Page, PageHeader } from '@/components/layout/Page';
import { NoteFilters } from '@/components/notes/NoteFilters';
import { NoteList } from '@/components/notes/NoteList';
import { Input, Label } from '@/components/ui/input';
import { EmptyState, Spinner } from '@/components/ui/misc';
import { useDebouncedValue } from '@/hooks/useDebounce';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useUrlFilters } from '@/hooks/useUrlFilters';

export default function SearchPage() {
  usePageMeta('Search');
  const [filters, setFilters] = useUrlFilters();
  const [q, setQ] = useState(filters.q ?? '');
  const debounced = useDebouncedValue(q.trim(), 300);

  useEffect(() => {
    if ((filters.q ?? '') !== debounced) setFilters({ q: debounced || undefined });
  }, [debounced, filters.q, setFilters]);

  const hasFilters = Boolean(
    filters.moduleId ||
    filters.academicYear ||
    filters.from ||
    filters.to ||
    filters.tags ||
    filters.favourite ||
    filters.updatedWithinDays,
  );
  const searching = Boolean(filters.q);
  const search = useSearch({ ...filters, pageSize: 20 }, searching);
  const list = useNotes({ ...filters, q: undefined, pageSize: 20 }, !searching && hasFilters);
  const result = searching ? search : list;

  return (
    <Page>
      <PageHeader
        title="Search"
        description="Full-text search across titles, content, tags and module names."
      />
      <form role="search" onSubmit={(e) => e.preventDefault()} className="relative mb-4">
        <Label htmlFor="search-input" className="sr-only">
          Search notes
        </Label>
        <SearchIcon
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          id="search-input"
          type="search"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search notes…"
          className="h-11 pl-9 text-base"
        />
        {result.isFetching && (
          <Spinner className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2" />
        )}
      </form>
      <div className="mb-4">
        <NoteFilters value={filters} onChange={setFilters} allowRelevance={searching} />
      </div>
      {!searching && !hasFilters ? (
        <EmptyState
          icon={<SearchIcon />}
          title="Search your notes"
          description="Type a word or phrase, or pick filters to browse. Partial words match too."
        />
      ) : (
        <NoteList
          data={result.data}
          isLoading={result.isLoading}
          onPage={(page) => setFilters({ page })}
          empty={
            <EmptyState
              icon={<SearchIcon />}
              title="No results"
              description="Try different words or fewer filters."
            />
          }
        />
      )}
    </Page>
  );
}
