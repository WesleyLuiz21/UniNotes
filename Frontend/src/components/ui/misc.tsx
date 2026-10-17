import * as React from 'react';
import { Popover as P, Switch as S, Tabs as T, Tooltip as TT } from 'radix-ui';
import { cn } from '@/lib/utils';

// ---------- Card ----------
export const Card = ({ className, ...p }: React.ComponentProps<'div'>) => (
  <div
    className={cn('border-border bg-surface text-foreground rounded-xl border shadow-xs', className)}
    {...p}
  />
);
export const CardHeader = ({ className, ...p }: React.ComponentProps<'div'>) => (
  <div className={cn('flex flex-col gap-1 p-4 pb-2 sm:p-5 sm:pb-2', className)} {...p} />
);
export const CardTitle = ({ className, ...p }: React.ComponentProps<'h2'>) => (
  <h2 className={cn('text-base font-semibold', className)} {...p} />
);
export const CardDescription = ({ className, ...p }: React.ComponentProps<'p'>) => (
  <p className={cn('text-muted-foreground text-sm', className)} {...p} />
);
export const CardContent = ({ className, ...p }: React.ComponentProps<'div'>) => (
  <div className={cn('p-4 pt-2 sm:p-5 sm:pt-2', className)} {...p} />
);

// ---------- Badge ----------
export function Badge({
  className,
  variant = 'default',
  ...p
}: React.ComponentProps<'span'> & { variant?: 'default' | 'outline' | 'success' | 'warning' | 'danger' }) {
  const styles = {
    default: 'bg-elevated text-foreground',
    outline: 'border border-border text-muted-foreground',
    success: 'bg-success/15 text-success',
    warning: 'bg-warning/15 text-warning',
    danger: 'bg-danger/15 text-danger',
  }[variant];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium',
        styles,
        className,
      )}
      {...p}
    />
  );
}

// ---------- Skeleton ----------
export const Skeleton = ({ className, ...p }: React.ComponentProps<'div'>) => (
  <div aria-hidden className={cn('bg-elevated animate-pulse rounded-md', className)} {...p} />
);

// ---------- Separator ----------
export const Separator = ({ className, ...p }: React.ComponentProps<'hr'>) => (
  <hr className={cn('border-border', className)} {...p} />
);

// ---------- Tooltip ----------
export const TooltipProvider = TT.Provider;
export function Tooltip({
  content,
  children,
  side = 'bottom',
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <TT.Root>
      <TT.Trigger asChild>{children}</TT.Trigger>
      <TT.Portal>
        <TT.Content
          side={side}
          sideOffset={6}
          className="bg-foreground text-background z-50 rounded-md px-2 py-1 text-xs shadow-md"
        >
          {content}
        </TT.Content>
      </TT.Portal>
    </TT.Root>
  );
}

// ---------- Popover ----------
export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'border-border bg-surface text-foreground z-50 w-72 rounded-lg border p-3 shadow-lg outline-none',
          className,
        )}
        {...props}
      />
    </P.Portal>
  );
}

// ---------- Switch ----------
export function Switch({ className, ...props }: React.ComponentProps<typeof S.Root>) {
  return (
    <S.Root
      className={cn(
        'peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <S.Thumb className="pointer-events-none block size-4 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5" />
    </S.Root>
  );
}

// ---------- Tabs ----------
export const Tabs = T.Root;
export function TabsList({ className, ...p }: React.ComponentProps<typeof T.List>) {
  return (
    <T.List
      className={cn(
        'bg-elevated text-muted-foreground inline-flex h-9 max-w-full [scrollbar-width:none] items-center gap-1 overflow-x-auto rounded-lg p-1',
        className,
      )}
      {...p}
    />
  );
}
export function TabsTrigger({ className, ...p }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        'hover:text-foreground data-[state=active]:bg-surface data-[state=active]:text-foreground inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-medium whitespace-nowrap transition-colors data-[state=active]:shadow-sm [&_svg]:size-4',
        className,
      )}
      {...p}
    />
  );
}
export const TabsContent = T.Content;

// ---------- Segmented control (radio group semantics) ----------
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; icon?: React.ReactNode; title?: string }[];
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('bg-elevated inline-flex h-8 items-center gap-0.5 rounded-lg p-0.5', className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'text-muted-foreground hover:text-foreground inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors [&_svg]:size-4',
            value === o.value && 'bg-surface text-foreground shadow-sm',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Empty state ----------
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'border-border flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="bg-elevated text-muted-foreground rounded-full p-3 [&_svg]:size-6">{icon}</div>
      ) : null}
      <div className="grid gap-1">
        <p className="font-medium">{title}</p>
        {description ? <p className="text-muted-foreground max-w-sm text-sm">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('size-4 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
