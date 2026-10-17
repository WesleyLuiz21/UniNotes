import { useState } from 'react';
import { useNavigate } from 'react-router';
import { FileText, FileUp, Plus, SlidersHorizontal } from 'lucide-react';
import { useNotes } from '@/api/notes';
import { Page, PageHeader } from '@/components/layout/Page';
import { ImportDialog } from '@/components/notes/ImportDialog';
import { NoteFilters } from '@/components/notes/NoteFilters';
import { NoteList } from '@/components/notes/NoteList';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useUrlFilters } from '@/hooks/useUrlFilters';

export default function NotesPage() {
  usePageMeta('Notes');
  const navigate = useNavigate();
  const [filters, setFilters] = useUrlFilters();
  const [showFilters, setShowFilters] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const { data, isLoading } = useNotes({ ...filters, pageSize: 20 });

  return (
    <Page>
      <PageHeader
        title="Notes"
        description="All your lecture notes. Use filters to narrow down by module, date or tag."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => setShowFilters((s) => !s)}
              aria-expanded={showFilters}
              aria-controls="notes-filters"
            >
              <SlidersHorizontal /> Filters
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <FileUp /> Import
            </Button>
            <Button onClick={() => navigate('/notes/new')}>
              <Plus /> New note
            </Button>
          </>
        }
      />
      {showFilters && (
        <div id="notes-filters" className="mb-4">
          <NoteFilters value={filters} onChange={setFilters} />
        </div>
      )}
      <NoteList
        data={data}
        isLoading={isLoading}
        onPage={(page) => setFilters({ page })}
        empty={
          <EmptyState
            icon={<FileText />}
            title="No notes match"
            description="Try clearing filters, or create a new note."
            action={
              <Button onClick={() => navigate('/notes/new')}>
                <Plus /> New note
              </Button>
            }
          />
        }
      />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </Page>
  );
}
