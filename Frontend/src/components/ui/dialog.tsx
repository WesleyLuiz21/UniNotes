import * as React from 'react';
import { AlertDialog as AD, Dialog as D } from 'radix-ui';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buttonVariants } from './button';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

const overlay =
  'fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0';
const panel =
  'fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl border border-border bg-surface p-5 text-foreground shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 sm:p-6';

export function DialogContent({
  className,
  children,
  size = 'md',
  hideClose,
  ...props
}: React.ComponentProps<typeof D.Content> & { size?: 'sm' | 'md' | 'lg' | 'xl'; hideClose?: boolean }) {
  const width = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-5xl' }[size];
  return (
    <D.Portal>
      <D.Overlay className={overlay} />
      <D.Content className={cn(panel, width, className)} {...props}>
        {children}
        {!hideClose && (
          <D.Close
            className="text-muted-foreground hover:bg-hover absolute top-4 right-4 rounded-sm p-1 opacity-80 hover:opacity-100"
            aria-label="Close"
          >
            <XIcon className="size-4" />
          </D.Close>
        )}
      </D.Content>
    </D.Portal>
  );
}

export const DialogHeader = ({ className, ...p }: React.ComponentProps<'div'>) => (
  <div className={cn('grid gap-1.5 pr-6', className)} {...p} />
);
export const DialogFooter = ({ className, ...p }: React.ComponentProps<'div'>) => (
  <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...p} />
);
export const DialogTitle = ({ className, ...p }: React.ComponentProps<typeof D.Title>) => (
  <D.Title className={cn('text-lg font-semibold', className)} {...p} />
);
export const DialogDescription = ({ className, ...p }: React.ComponentProps<typeof D.Description>) => (
  <D.Description className={cn('text-muted-foreground text-sm', className)} {...p} />
);

/** Side sheet (used for the mobile navigation drawer). */
export function SheetContent({
  className,
  children,
  side = 'left',
  ...props
}: React.ComponentProps<typeof D.Content> & { side?: 'left' | 'right' }) {
  return (
    <D.Portal>
      <D.Overlay className={overlay} />
      <D.Content
        className={cn(
          'bg-sidebar data-[state=open]:animate-in data-[state=closed]:animate-out fixed inset-y-0 z-50 flex w-72 max-w-[85vw] flex-col shadow-xl',
          side === 'left'
            ? 'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left left-0 border-r'
            : 'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right right-0 border-l',
          className,
        )}
        {...props}
      >
        {children}
      </D.Content>
    </D.Portal>
  );
}

// ---------- Confirmation dialog ----------
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive,
  onConfirm,
  pending,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  pending?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <AD.Root open={open} onOpenChange={onOpenChange}>
      <AD.Portal>
        <AD.Overlay className={overlay} />
        <AD.Content className={cn(panel, 'sm:max-w-md')}>
          <div className="grid gap-1.5">
            <AD.Title className="text-lg font-semibold">{title}</AD.Title>
            {description ? (
              <AD.Description className="text-muted-foreground text-sm">{description}</AD.Description>
            ) : null}
          </div>
          {children}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AD.Cancel className={buttonVariants({ variant: 'outline' })}>Cancel</AD.Cancel>
            <AD.Action
              className={buttonVariants({ variant: destructive ? 'destructive' : 'default' })}
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
            >
              {confirmLabel}
            </AD.Action>
          </div>
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}
