import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useSession } from '@/api/auth';
import { useUpdateAccount } from '@/api/settings';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Spinner } from '@/components/ui/misc';
import { usePageMeta } from '@/hooks/usePageMeta';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';

const Schema = z.object({
  displayName: z.string().trim().min(1, 'Required').max(100),
  username: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dots, dashes or underscores'),
  email: z.union([z.email('Enter a valid email'), z.literal('')]),
  currentPassword: z.string(),
  code: z.string(),
});
type Values = z.infer<typeof Schema>;

export default function AccountSettings() {
  usePageMeta('Account', [{ label: 'Settings', to: '/settings' }]);
  const { data } = useSession();
  const user = data?.user;
  const update = useUpdateAccount();
  const form = useForm<Values>({ resolver: zodResolver(Schema) });
  const { errors } = form.formState;
  const [username, email] = form.watch(['username', 'email']);
  const identifierChanged = Boolean(
    user &&
    (username?.toLowerCase() !== user.username || (email || null)?.toLowerCase() !== (user.email ?? null)),
  );

  useEffect(() => {
    if (user)
      form.reset({
        displayName: user.displayName,
        username: user.username,
        email: user.email ?? '',
        currentPassword: '',
        code: '',
      });
  }, [user, form]);

  const submit = form.handleSubmit((v) =>
    update.mutate(
      {
        displayName: v.displayName,
        username: v.username,
        email: v.email,
        ...(identifierChanged ? { currentPassword: v.currentPassword, code: v.code || undefined } : {}),
      },
      { onSuccess: () => toast.success('Account updated'), onError: (e) => toast.error(errorMessage(e)) },
    ),
  );

  if (!user) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>Member since {formatDateTime(user.createdAt)}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid max-w-md gap-4" noValidate>
          <Field label="Display name" htmlFor="displayName" error={errors.displayName?.message}>
            <Input id="displayName" autoComplete="name" {...form.register('displayName')} />
          </Field>
          <Field label="Username" htmlFor="username" error={errors.username?.message} hint="Used to sign in.">
            <Input id="username" autoComplete="username" {...form.register('username')} />
          </Field>
          <Field
            label="Email"
            htmlFor="email"
            error={errors.email?.message}
            hint="Optional. Can also be used to sign in."
          >
            <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
          </Field>
          {identifierChanged && (
            <div className="border-border grid gap-4 rounded-md border p-3">
              <p className="text-muted-foreground text-sm">
                Changing how you sign in requires your current password
                {user.mfaEnabled ? ' and an authentication code' : ''}.
              </p>
              <Field label="Current password" htmlFor="acc-password">
                <Input
                  id="acc-password"
                  type="password"
                  autoComplete="current-password"
                  {...form.register('currentPassword')}
                />
              </Field>
              {user.mfaEnabled && (
                <Field label="Authentication code" htmlFor="acc-code">
                  <Input id="acc-code" autoComplete="one-time-code" {...form.register('code')} />
                </Field>
              )}
            </div>
          )}
          <Button type="submit" className="justify-self-start" disabled={update.isPending}>
            {update.isPending && <Spinner />} Save changes
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
