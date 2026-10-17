import type { ModuleRef } from '@/lib/types';
import { cn } from '@/lib/utils';

export function ModuleDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn('inline-block size-2.5 shrink-0 rounded-full', className)}
      style={{ background: color }}
      aria-hidden
    />
  );
}

export function ModuleBadge({ module, className }: { module: ModuleRef | null; className?: string }) {
  if (!module) return <span className={cn('text-muted-foreground text-xs', className)}>No module</span>;
  return (
    <span className={cn('text-muted-foreground inline-flex min-w-0 items-center gap-1.5 text-xs', className)}>
      <ModuleDot color={module.color} />
      <span className="truncate">{module.code ? `${module.code} · ${module.name}` : module.name}</span>
    </span>
  );
}
