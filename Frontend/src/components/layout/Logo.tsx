import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <path d="M9 9v8.5a7 7 0 0 0 14 0V9" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <path d="M13 23h6" stroke="#93C5FD" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className, collapsed }: { className?: string; collapsed?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <LogoMark />
      {!collapsed && <span className="text-[15px] font-semibold tracking-tight">UniNotes</span>}
    </div>
  );
}
