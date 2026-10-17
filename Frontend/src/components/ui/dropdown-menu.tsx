import * as React from 'react';
import { DropdownMenu as DM } from 'radix-ui';
import { cn } from '@/lib/utils';

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;
export const DropdownMenuGroup = DM.Group;

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  align = 'end',
  ...props
}: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'border-border bg-surface text-foreground data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 z-50 min-w-48 overflow-hidden rounded-lg border p-1 shadow-lg',
          className,
        )}
        {...props}
      />
    </DM.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: React.ComponentProps<typeof DM.Item> & { destructive?: boolean }) {
  return (
    <DM.Item
      className={cn(
        'data-[highlighted]:bg-hover [&_svg]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4',
        destructive && 'text-danger [&_svg]:text-danger',
        className,
      )}
      {...props}
    />
  );
}

export const DropdownMenuSeparator = ({ className, ...p }: React.ComponentProps<typeof DM.Separator>) => (
  <DM.Separator className={cn('bg-border -mx-1 my-1 h-px', className)} {...p} />
);
export const DropdownMenuLabel = ({ className, ...p }: React.ComponentProps<typeof DM.Label>) => (
  <DM.Label className={cn('text-muted-foreground px-2 py-1.5 text-xs font-medium', className)} {...p} />
);
