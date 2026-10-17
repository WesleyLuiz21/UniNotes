import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useCalendar } from '@/api/misc';
import { useModules } from '@/api/modules';
import { useNotes } from '@/api/notes';
import { Page } from '@/components/layout/Page';
import { ModuleBadge } from '@/components/modules/ModuleBadge';
import { NoteList } from '@/components/notes/NoteList';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { EmptyState, Segmented, Skeleton } from '@/components/ui/misc';
import { usePageMeta } from '@/hooks/usePageMeta';
import { parseDateOnly, toDateOnly } from '@/lib/dates';
import type { CalendarDay } from '@/lib/types';
import { cn } from '@/lib/utils';

const WEEK = { weekStartsOn: 1 as const };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function CalendarPage() {
  usePageMeta('Calendar');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const initial = params.get('date');
  const [view, setView] = useState<'month' | 'week'>(
    (params.get('view') as 'week') === 'week' ? 'week' : 'month',
  );
  const [cursor, setCursor] = useState(() =>
    initial && /^\d{4}-\d{2}-\d{2}$/.test(initial) ? parseDateOnly(initial) : new Date(),
  );
  const [selected, setSelected] = useState<Date>(cursor);
  const [moduleId, setModuleId] = useState(params.get('moduleId') ?? '');
  const { data: modules } = useModules('all');
  const gridRef = useRef<HTMLDivElement>(null);

  const range = useMemo(() => {
    if (view === 'month')
      return { start: startOfWeek(startOfMonth(cursor), WEEK), end: endOfWeek(endOfMonth(cursor), WEEK) };
    return { start: startOfWeek(cursor, WEEK), end: endOfWeek(cursor, WEEK) };
  }, [cursor, view]);
  const from = toDateOnly(range.start);
  const to = toDateOnly(range.end);
  const { data: days, isLoading } = useCalendar(from, to, moduleId || undefined);
  const byDate = useMemo(() => new Map((days ?? []).map((d) => [d.date, d])), [days]);
  const selectedKey = toDateOnly(selected);
  const dayNotes = useNotes(
    { date: selectedKey, moduleId: moduleId || undefined, sort: 'title', pageSize: 50 },
    view === 'month',
  );
  const weekNotes = useNotes(
    { from, to, moduleId: moduleId || undefined, sort: 'lecture_asc', pageSize: 100 },
    view === 'week',
  );

  const select = (d: Date, focus = false) => {
    setSelected(d);
    if (!isSameMonth(d, cursor) || view === 'week') setCursor(d);
    setParams((p) => (p.set('date', toDateOnly(d)), p), { replace: true });
    if (focus)
      requestAnimationFrame(() =>
        gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${toDateOnly(d)}"]`)?.focus(),
      );
  };
  const step = (dir: 1 | -1) => {
    const next = view === 'month' ? addMonths(cursor, dir) : addWeeks(cursor, dir);
    setCursor(next);
    setSelected(view === 'month' ? startOfMonth(next) : startOfWeek(next, WEEK));
  };

  const onGridKey = (e: KeyboardEvent) => {
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (delta !== undefined) {
      e.preventDefault();
      select(addDays(selected, delta), true);
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      select(addMonths(selected, e.key === 'PageUp' ? -1 : 1), true);
    } else if (e.key === 'Home') {
      e.preventDefault();
      select(startOfWeek(selected, WEEK), true);
    } else if (e.key === 'End') {
      e.preventDefault();
      select(endOfWeek(selected, WEEK), true);
    }
  };

  const title =
    view === 'month'
      ? format(cursor, 'MMMM yyyy')
      : `${format(range.start, 'd MMM')} – ${format(range.end, 'd MMM yyyy')}`;
  const newNoteUrl = (d: Date) =>
    `/notes/new?date=${toDateOnly(d)}${moduleId ? `&moduleId=${moduleId}` : ''}`;

  return (
    <Page wide>
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <h1 className="min-w-0 text-2xl font-semibold tracking-tight" aria-live="polite">
            {title}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => step(-1)}
            aria-label={view === 'month' ? 'Previous month' : 'Previous week'}
          >
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="sm" onClick={() => select(new Date())}>
            Today
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => step(1)}
            aria-label={view === 'month' ? 'Next month' : 'Next week'}
          >
            <ChevronRight />
          </Button>
          <Label htmlFor="cal-month" className="sr-only">
            Jump to month
          </Label>
          <Input
            id="cal-month"
            type="month"
            className="h-8 w-auto text-[13px]"
            value={format(cursor, 'yyyy-MM')}
            onChange={(e) => {
              if (!e.target.value) return;
              const d = parseDateOnly(`${e.target.value}-01`);
              setCursor(d);
              setSelected(d);
            }}
          />
          <Label htmlFor="cal-module" className="sr-only">
            Filter by module
          </Label>
          <NativeSelect
            id="cal-module"
            className="h-8 w-auto max-w-48 text-[13px]"
            value={moduleId}
            onChange={(e) => setModuleId(e.target.value)}
          >
            <option value="">All modules</option>
            {modules?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
          <Segmented
            label="Calendar view"
            value={view}
            onChange={setView}
            options={[
              { value: 'month', label: 'Month' },
              { value: 'week', label: 'Week' },
            ]}
          />
        </div>
      </div>

      {view === 'month' ? (
        <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
          <div
            ref={gridRef}
            role="grid"
            aria-label={`Calendar, ${title}`}
            onKeyDown={onGridKey}
            className="border-border bg-surface overflow-hidden rounded-xl border"
          >
            <div role="row" className="border-border bg-elevated/50 grid grid-cols-7 border-b">
              {WEEKDAYS.map((d) => (
                <div
                  role="columnheader"
                  key={d}
                  className="text-muted-foreground py-2 text-center text-xs font-medium"
                >
                  {d}
                </div>
              ))}
            </div>
            {chunk(eachDayOfInterval(range), 7).map((week, wi) => (
              <div role="row" key={wi} className="grid grid-cols-7">
                {week.map((d) => (
                  <MonthCell
                    key={d.toISOString()}
                    day={d}
                    info={byDate.get(toDateOnly(d))}
                    inMonth={isSameMonth(d, cursor)}
                    selected={isSameDay(d, selected)}
                    loading={isLoading}
                    onSelect={() => select(d)}
                  />
                ))}
              </div>
            ))}
          </div>

          <section aria-labelledby="day-heading" className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 id="day-heading" className="text-lg font-semibold">
                {format(selected, 'EEEE d MMMM yyyy')}
              </h2>
              <Button size="sm" onClick={() => navigate(newNoteUrl(selected))}>
                <Plus /> New note
              </Button>
            </div>
            <NoteList
              data={dayNotes.data}
              isLoading={dayNotes.isLoading}
              onPage={() => undefined}
              empty={
                <EmptyState
                  title="No notes on this date"
                  description="Lecture notes dated this day will appear here."
                  className="py-8"
                />
              }
            />
          </section>
        </div>
      ) : (
        <div
          className="grid gap-3 md:grid-cols-7"
          role="list"
          aria-label={`Week of ${format(range.start, 'd MMMM yyyy')}`}
        >
          {eachDayOfInterval(range).map((d) => {
            const key = toDateOnly(d);
            const notes = (weekNotes.data?.items ?? []).filter((n) => n.lectureDate === key);
            return (
              <section
                role="listitem"
                key={key}
                className={cn(
                  'border-border bg-surface flex min-h-40 flex-col rounded-xl border p-2',
                  isToday(d) && 'border-accent',
                )}
                aria-label={format(d, 'EEEE d MMMM')}
              >
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className={cn('text-sm font-medium', isToday(d) && 'text-accent')}>
                    {format(d, 'EEE')} <span className="text-muted-foreground">{format(d, 'd MMM')}</span>
                  </span>
                  <Link
                    to={newNoteUrl(d)}
                    className="text-muted-foreground hover:bg-hover hover:text-foreground rounded p-1"
                    aria-label={`New note on ${format(d, 'd MMMM')}`}
                  >
                    <Plus className="size-4" />
                  </Link>
                </div>
                {weekNotes.isLoading ? (
                  <Skeleton className="h-10" />
                ) : (
                  <ul className="grid gap-1.5">
                    {notes.map((n) => (
                      <li key={n.id}>
                        <Link
                          to={`/notes/${n.id}`}
                          className="border-border hover:bg-hover block rounded-md border px-2 py-1.5"
                        >
                          <span className="line-clamp-2 text-sm font-medium">{n.title}</span>
                          <ModuleBadge module={n.module} className="mt-0.5" />
                        </Link>
                      </li>
                    ))}
                    {notes.length === 0 && <li className="text-muted-foreground px-1 text-xs">No notes</li>}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Page>
  );
}

function MonthCell({
  day,
  info,
  inMonth,
  selected,
  loading,
  onSelect,
}: {
  day: Date;
  info?: CalendarDay;
  inMonth: boolean;
  selected: boolean;
  loading: boolean;
  onSelect: () => void;
}) {
  const count = info?.count ?? 0;
  const label = `${format(day, 'EEEE d MMMM yyyy')}${count ? `, ${count} ${count === 1 ? 'note' : 'notes'}` : ''}`;
  const colors = [...new Set((info?.modules ?? []).map((m) => m.color))].slice(0, 4);
  return (
    <div
      role="gridcell"
      aria-selected={selected}
      className="border-border border-r border-b last:border-r-0 [&:nth-child(7)]:border-r-0"
    >
      <button
        type="button"
        data-date={toDateOnly(day)}
        tabIndex={selected ? 0 : -1}
        onClick={onSelect}
        aria-label={label}
        aria-pressed={selected}
        className={cn(
          'hover:bg-hover flex h-16 w-full flex-col items-start gap-1 p-1.5 text-left transition-colors sm:h-24 sm:p-2',
          !inMonth && 'text-muted-foreground/60',
          selected && 'bg-primary/10 hover:bg-primary/15',
        )}
      >
        <span
          className={cn(
            'grid size-6 place-items-center rounded-full text-xs font-medium sm:text-sm',
            isToday(day) && 'bg-primary text-primary-foreground',
          )}
        >
          {format(day, 'd')}
        </span>
        {!loading && count > 0 && (
          <span className="flex w-full items-center gap-1" aria-hidden>
            <span className="flex gap-0.5">
              {colors.length ? (
                colors.map((c) => (
                  <span key={c} className="size-1.5 rounded-full sm:size-2" style={{ background: c }} />
                ))
              ) : (
                <span className="bg-muted-foreground size-1.5 rounded-full sm:size-2" />
              )}
            </span>
            <span className="bg-elevated text-muted-foreground ml-auto hidden rounded px-1 text-[11px] tabular-nums sm:inline">
              {count}
            </span>
          </span>
        )}
      </button>
    </div>
  );
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
