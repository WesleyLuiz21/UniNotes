import * as React from 'react';
import { cn } from '@/lib/utils';

export const inputClass =
  'flex h-9 w-full min-w-0 rounded-md border border-input bg-surface px-3 py-1 text-sm text-foreground shadow-xs transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-0';

export function Input({ className, type = 'text', ...props }: React.ComponentProps<'input'>) {
  return <input type={type} className={cn(inputClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea className={cn(inputClass, 'h-auto min-h-20 py-2', className)} {...props} />;
}

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label className={cn('text-sm leading-none font-medium', className)} {...props} />;
}

/** Native select styled to match inputs (best mobile/a11y behaviour). */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select className={cn(inputClass, 'appearance-auto pr-2', className)} {...props}>
      {children}
    </select>
  );
}

export function FieldError({ id, children }: { id?: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-danger text-[13px]">
      {children}
    </p>
  );
}

/** Label + control + error, with aria wiring. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
}: {
  label: React.ReactNode;
  htmlFor: string;
  error?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error ? <p className="text-muted-foreground text-[13px]">{hint}</p> : null}
      <FieldError id={`${htmlFor}-error`}>{error}</FieldError>
    </div>
  );
}
