import type { ReactNode } from 'react';
import { FileText } from 'lucide-react';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import type { NoteSummary } from '@/lib/types';
import { NoteCard } from './NoteCard';
import { Pagination } from './Pagination';

export function NoteList({
  data,
  isLoading,
  onPage,
  empty,
  showModule,
  renderActions,
  hrefFor,
}: {
  data?: { items: NoteSummary[]; total: number; page: number; pageSize: number };
  isLoading: boolean;
  onPage: (p: number) => void;
  empty?: ReactNode;
  showModule?: boolean;
  renderActions?: (n: NoteSummary) => ReactNode;
  hrefFor?: (n: NoteSummary) => string;
}) {
  if (isLoading && !data) {
    return (
      <div className="grid gap-3" aria-busy="true" aria-label="Loading notes">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  if (!data || data.items.length === 0)
    return <>{empty ?? <EmptyState icon={<FileText />} title="No notes found" />}</>;
  return (
    <div>
      <p className="sr-only" aria-live="polite">
        {data.total} notes
      </p>
      <ul className="grid gap-3">
        {data.items.map((n) => (
          <li key={n.id}>
            <NoteCard note={n} showModule={showModule} actions={renderActions?.(n)} to={hrefFor?.(n)} />
          </li>
        ))}
      </ul>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={onPage} />
    </div>
  );
}
