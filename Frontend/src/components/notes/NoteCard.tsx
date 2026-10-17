import { Link } from 'react-router';
import { Star } from 'lucide-react';
import { useUpdateNoteMeta } from '@/api/notes';
import { ModuleBadge } from '@/components/modules/ModuleBadge';
import { formatLectureDate, formatRelative } from '@/lib/dates';
import type { NoteSummary } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Highlight } from './Highlight';

export function FavouriteButton({
  note,
  className,
}: {
  note: Pick<NoteSummary, 'id' | 'isFavourite' | 'title'>;
  className?: string;
}) {
  const update = useUpdateNoteMeta();
  const fav = update.isPending ? !note.isFavourite : note.isFavourite;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        update.mutate({ id: note.id, isFavourite: !note.isFavourite });
      }}
      className={cn(
        'text-muted-foreground hover:bg-hover hover:text-warning grid size-8 place-items-center rounded-md',
        fav && 'text-warning',
        className,
      )}
      aria-label={fav ? `Remove “${note.title}” from favourites` : `Add “${note.title}” to favourites`}
      aria-pressed={fav}
    >
      <Star className={cn('size-4', fav && 'fill-current')} />
    </button>
  );
}

export function NoteCard({
  note,
  to,
  showModule = true,
  actions,
}: {
  note: NoteSummary;
  to?: string;
  showModule?: boolean;
  actions?: React.ReactNode;
}) {
  const href = to ?? `/notes/${note.id}`;
  return (
    <article className="group border-border bg-surface hover:border-input hover:bg-elevated/40 relative flex gap-3 rounded-lg border p-4 transition-colors">
      <div className="min-w-0 flex-1">
        <h3 className="flex items-center gap-2 pr-8 font-medium">
          <Link
            to={href}
            className="min-w-0 truncate after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
          >
            {note.titleHighlight ? <Highlight text={note.titleHighlight} /> : note.title}
          </Link>
        </h3>
        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {showModule && <ModuleBadge module={note.module} />}
          <span>
            <span className="sr-only">Lecture date: </span>
            {formatLectureDate(note.lectureDate)}
          </span>
          <span title={new Date(note.updatedAt).toLocaleString()}>
            Edited {formatRelative(note.updatedAt)}
          </span>
          {note.archivedAt && <span className="bg-elevated rounded px-1.5 py-0.5">Archived</span>}
        </div>
        {note.snippet !== undefined ? (
          <Highlight
            text={note.snippet}
            className="text-muted-foreground mt-2 line-clamp-2 text-sm whitespace-pre-line"
          />
        ) : note.excerpt ? (
          <p className="text-muted-foreground mt-2 line-clamp-2 text-sm">{note.excerpt}</p>
        ) : null}
        {note.tags.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1" aria-label="Tags">
            {note.tags.map((t) => (
              <li key={t} className="bg-elevated text-muted-foreground rounded px-1.5 py-0.5 text-xs">
                #{t}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="relative z-10 flex flex-col items-end gap-1 self-start">
        {actions ?? <FavouriteButton note={note} className="absolute -top-2 -right-2" />}
      </div>
    </article>
  );
}
