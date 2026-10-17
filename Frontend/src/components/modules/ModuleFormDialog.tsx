import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { useCreateModule, useUpdateModule } from '@/api/modules';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Spinner } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api';
import { academicYearFor } from '@/lib/dates';
import type { Module } from '@/lib/types';
import { cn } from '@/lib/utils';

export const MODULE_COLORS = [
  { value: '#3B82F6', name: 'Blue' },
  { value: '#10B981', name: 'Green' },
  { value: '#F59E0B', name: 'Amber' },
  { value: '#EF4444', name: 'Red' },
  { value: '#8B5CF6', name: 'Violet' },
  { value: '#EC4899', name: 'Pink' },
  { value: '#14B8A6', name: 'Teal' },
  { value: '#F97316', name: 'Orange' },
  { value: '#6366F1', name: 'Indigo' },
  { value: '#84CC16', name: 'Lime' },
];

const Schema = z.object({
  name: z.string().trim().min(1, 'Give the module a name').max(120),
  code: z.string().trim().max(30),
  academicYear: z
    .string()
    .trim()
    .max(20)
    .regex(/^[\w ./-]*$/, 'Use a format like 2025/26'),
  description: z.string().trim().max(2000),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});
type Values = z.infer<typeof Schema>;

export function ModuleFormDialog({
  open,
  onOpenChange,
  module,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  module?: Module;
  onSaved?: (m: Module) => void;
}) {
  const create = useCreateModule();
  const update = useUpdateModule();
  const form = useForm<Values>({ resolver: zodResolver(Schema) });
  const { errors } = form.formState;
  const color = form.watch('color');

  useEffect(() => {
    if (open) {
      form.reset({
        name: module?.name ?? '',
        code: module?.code ?? '',
        academicYear: module?.academicYear ?? academicYearFor(),
        description: module?.description ?? '',
        color: module?.color ?? MODULE_COLORS[0]!.value,
      });
    }
  }, [open, module, form]);

  const pending = create.isPending || update.isPending;
  const submit = form.handleSubmit((v) => {
    const body = { ...v, code: v.code || null, academicYear: v.academicYear || null };
    const opts = {
      onSuccess: (m: Module) => {
        toast.success(module ? 'Module updated' : 'Module created');
        onSaved?.(m);
        onOpenChange(false);
      },
      onError: (e: unknown) => toast.error(errorMessage(e)),
    };
    if (module) update.mutate({ id: module.id, ...body }, opts);
    else create.mutate(body, opts);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{module ? 'Edit module' : 'New module'}</DialogTitle>
          <DialogDescription>Modules group your notes by university subject.</DialogDescription>
        </DialogHeader>
        <form id="module-form" onSubmit={submit} className="grid gap-4" noValidate>
          <Field label="Name" htmlFor="m-name" error={errors.name?.message}>
            <Input
              id="m-name"
              autoFocus
              placeholder="e.g. Data Structures"
              aria-invalid={Boolean(errors.name)}
              {...form.register('name')}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Module code" htmlFor="m-code" hint="Optional" error={errors.code?.message}>
              <Input id="m-code" placeholder="e.g. CS2001" {...form.register('code')} />
            </Field>
            <Field label="Academic year" htmlFor="m-year" error={errors.academicYear?.message}>
              <Input id="m-year" placeholder="2025/26" {...form.register('academicYear')} />
            </Field>
          </div>
          <Field label="Description" htmlFor="m-desc" error={errors.description?.message}>
            <Textarea id="m-desc" rows={3} placeholder="Optional" {...form.register('description')} />
          </Field>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Colour</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Module colour">
              {MODULE_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={color?.toUpperCase() === c.value}
                  aria-label={c.name}
                  onClick={() => form.setValue('color', c.value, { shouldDirty: true })}
                  className={cn(
                    'ring-offset-surface grid size-8 place-items-center rounded-full ring-offset-2',
                    color?.toUpperCase() === c.value && 'ring-foreground ring-2',
                  )}
                  style={{ background: c.value }}
                >
                  {color?.toUpperCase() === c.value && <Check className="size-4 text-white" aria-hidden />}
                </button>
              ))}
            </div>
          </fieldset>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="module-form" disabled={pending}>
            {pending && <Spinner />}
            {module ? 'Save changes' : 'Create module'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
