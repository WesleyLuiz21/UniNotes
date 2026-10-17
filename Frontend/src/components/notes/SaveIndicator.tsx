import { AlertTriangle, Check, CircleDot, CloudOff, RefreshCw } from 'lucide-react';
import type { SaveStatus } from '@/hooks/useAutosave';
import { formatRelative } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/misc';

export function SaveIndicator({
  status,
  lastSavedAt,
  error,
  onRetry,
}: {
  status: SaveStatus;
  lastSavedAt: string | null;
  error: string | null;
  onRetry: () => void;
}) {
  const content = {
    idle: { icon: <CircleDot className="size-3.5" />, text: 'Not saved yet', cls: 'text-muted-foreground' },
    unsaved: { icon: <CircleDot className="size-3.5" />, text: 'Unsaved changes', cls: 'text-warning' },
    saving: { icon: <Spinner className="size-3.5" />, text: 'Saving…', cls: 'text-muted-foreground' },
    saved: {
      icon: <Check className="size-3.5" />,
      text: lastSavedAt ? `Saved ${formatRelative(lastSavedAt)}` : 'Saved',
      cls: 'text-success',
    },
    error: { icon: <CloudOff className="size-3.5" />, text: 'Save failed', cls: 'text-danger' },
    conflict: { icon: <AlertTriangle className="size-3.5" />, text: 'Conflict detected', cls: 'text-danger' },
  }[status];
  return (
    <div className="flex items-center gap-2 text-xs" title={status === 'error' && error ? error : undefined}>
      <span
        role="status"
        aria-live="polite"
        className={cn('inline-flex items-center gap-1.5 font-medium whitespace-nowrap', content.cls)}
        data-testid="save-status"
        data-status={status}
      >
        {content.icon}
        {content.text}
      </span>
      {status === 'error' && (
        <button
          type="button"
          onClick={onRetry}
          className="text-accent inline-flex items-center gap-1 hover:underline"
        >
          <RefreshCw className="size-3" /> Retry
        </button>
      )}
    </div>
  );
}
