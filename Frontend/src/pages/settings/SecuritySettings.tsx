import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Copy, KeyRound, LogOut, Monitor, ShieldCheck, ShieldOff } from 'lucide-react';
import { useLogout, useSession } from '@/api/auth';
import {
  useChangePassword,
  useMfaDisable,
  useMfaEnable,
  useMfaSetup,
  useRegenerateRecoveryCodes,
  useRevokeSession,
  useSecurity,
  useSecurityEvents,
} from '@/api/settings';
import { Button } from '@/components/ui/button';
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Spinner,
} from '@/components/ui/misc';
import { usePageMeta } from '@/hooks/usePageMeta';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/dates';

export default function SecuritySettings() {
  usePageMeta('Security', [{ label: 'Settings', to: '/settings' }]);
  return (
    <div className="grid gap-6">
      <PasswordCard />
      <MfaCard />
      <SessionsCard />
      <EventsCard />
    </div>
  );
}

// ---------- Password ----------
const PasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z.string().min(12, 'Use at least 12 characters').max(256),
    confirm: z.string(),
    code: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

function PasswordCard() {
  const { data } = useSession();
  const change = useChangePassword();
  const form = useForm<z.infer<typeof PasswordSchema>>({
    resolver: zodResolver(PasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '', code: '' },
  });
  const { errors } = form.formState;
  const submit = form.handleSubmit((v) =>
    change.mutate(
      { currentPassword: v.currentPassword, newPassword: v.newPassword, code: v.code || undefined },
      {
        onSuccess: () => {
          toast.success('Password changed. Other devices have been signed out.');
          form.reset();
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    ),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          {data?.user ? `Last changed ${formatRelative(data.user.passwordChangedAt)}. ` : ''}Use a long,
          unique passphrase. Changing it signs out all other sessions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid max-w-md gap-4" noValidate>
          <input type="text" autoComplete="username" value={data?.user?.username ?? ''} readOnly hidden />
          <Field label="Current password" htmlFor="pw-current" error={errors.currentPassword?.message}>
            <Input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              {...form.register('currentPassword')}
            />
          </Field>
          <Field
            label="New password"
            htmlFor="pw-new"
            error={errors.newPassword?.message}
            hint="At least 12 characters."
          >
            <Input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              {...form.register('newPassword')}
            />
          </Field>
          <Field label="Confirm new password" htmlFor="pw-confirm" error={errors.confirm?.message}>
            <Input
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              {...form.register('confirm')}
            />
          </Field>
          {data?.user?.mfaEnabled && (
            <Field label="Authentication code" htmlFor="pw-code">
              <Input id="pw-code" autoComplete="one-time-code" {...form.register('code')} />
            </Field>
          )}
          <Button type="submit" className="justify-self-start" disabled={change.isPending}>
            {change.isPending && <Spinner />} Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------- MFA ----------
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className="grid gap-3">
      <p className="text-sm">
        Save these recovery codes somewhere safe (for example a password manager). Each code can be used{' '}
        <strong>once</strong> if you lose access to your authenticator. They will not be shown again.
      </p>
      <ul
        className="bg-elevated grid grid-cols-2 gap-2 rounded-md p-3 font-mono text-sm"
        aria-label="Recovery codes"
      >
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void navigator.clipboard?.writeText(codes.join('\n')).then(() => toast.success('Copied'))
          }
        >
          <Copy /> Copy codes
        </Button>
        <Button size="sm" onClick={onDone}>
          I have saved my codes
        </Button>
      </div>
    </div>
  );
}

function MfaCard() {
  const { data, isLoading } = useSecurity();
  const [dialog, setDialog] = useState<'enable' | 'disable' | 'regenerate' | null>(null);
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            Two-factor authentication{' '}
            {data?.mfaEnabled ? <Badge variant="success">On</Badge> : <Badge variant="outline">Off</Badge>}
          </CardTitle>
          <CardDescription className="mt-1">
            Require a code from an authenticator app (TOTP) when signing in.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-9 w-40" />
        ) : data?.mfaEnabled ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-muted-foreground mr-auto text-sm">
              {data.recoveryCodesRemaining} recovery codes remaining.
            </p>
            <Button variant="outline" onClick={() => setDialog('regenerate')}>
              <KeyRound /> New recovery codes
            </Button>
            <Button variant="outline" onClick={() => setDialog('disable')}>
              <ShieldOff /> Disable
            </Button>
          </div>
        ) : (
          <Button onClick={() => setDialog('enable')}>
            <ShieldCheck /> Set up two-factor authentication
          </Button>
        )}
      </CardContent>
      <EnableMfaDialog open={dialog === 'enable'} onOpenChange={(o) => !o && setDialog(null)} />
      <ReauthMfaDialog
        mode={dialog === 'disable' || dialog === 'regenerate' ? dialog : null}
        onClose={() => setDialog(null)}
      />
    </Card>
  );
}

function EnableMfaDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const setup = useMfaSetup();
  const enable = useMfaEnable();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const close = () => {
    setup.reset();
    enable.reset();
    setPassword('');
    setCode('');
    setCodes(null);
    onOpenChange(false);
  };
  const secret = setup.data;
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : codes ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set up two-factor authentication</DialogTitle>
          <DialogDescription>
            {codes
              ? 'Two-factor authentication is now on.'
              : !secret
                ? 'Confirm your password to continue.'
                : 'Scan the QR code with your authenticator app, then enter the 6-digit code.'}
          </DialogDescription>
        </DialogHeader>
        {codes ? (
          <RecoveryCodes codes={codes} onDone={close} />
        ) : !secret ? (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setup.mutate(password, { onError: (err) => toast.error(errorMessage(err)) });
            }}
          >
            <Field label="Current password" htmlFor="mfa-pw">
              <Input
                id="mfa-pw"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={!password || setup.isPending}>
                {setup.isPending && <Spinner />} Continue
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              enable.mutate(code.trim(), {
                onSuccess: (r) => setCodes(r.recoveryCodes),
                onError: (err) => toast.error(errorMessage(err)),
              });
            }}
          >
            <div className="grid justify-items-center gap-3">
              <img
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(secret.qrSvg)}`}
                alt="QR code for your authenticator app"
                className="size-48 rounded-md bg-white p-2"
              />
              <p className="text-muted-foreground text-center text-xs">
                Can’t scan? Enter this key manually:
                <br />
                <code className="text-foreground font-mono text-sm break-all select-all">
                  {secret.secret.replace(/(.{4})/g, '$1 ').trim()}
                </code>
              </p>
            </div>
            <Field label="6-digit code" htmlFor="mfa-code">
              <Input
                id="mfa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="font-mono tracking-widest"
              />
            </Field>
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={code.length !== 6 || enable.isPending}>
                {enable.isPending && <Spinner />} Enable
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReauthMfaDialog({ mode, onClose }: { mode: 'disable' | 'regenerate' | null; onClose: () => void }) {
  const disable = useMfaDisable();
  const regenerate = useRegenerateRecoveryCodes();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const close = () => {
    setPassword('');
    setCode('');
    setCodes(null);
    onClose();
  };
  const pending = disable.isPending || regenerate.isPending;
  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && !codes && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === 'disable' ? 'Disable two-factor authentication' : 'Generate new recovery codes'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'disable'
              ? 'Your account will be protected by your password only.'
              : 'Your existing recovery codes will stop working.'}
          </DialogDescription>
        </DialogHeader>
        {codes ? (
          <RecoveryCodes codes={codes} onDone={close} />
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const body = { currentPassword: password, code: code.trim() };
              if (mode === 'disable')
                disable.mutate(body, {
                  onSuccess: () => (toast.success('Two-factor authentication disabled'), close()),
                  onError: (err) => toast.error(errorMessage(err)),
                });
              else
                regenerate.mutate(body, {
                  onSuccess: (r) => setCodes(r.recoveryCodes),
                  onError: (err) => toast.error(errorMessage(err)),
                });
            }}
          >
            <Field label="Current password" htmlFor="re-pw">
              <Input
                id="re-pw"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field label="Authentication code or recovery code" htmlFor="re-code">
              <Input
                id="re-code"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant={mode === 'disable' ? 'destructive' : 'default'}
                disabled={!password || !code || pending}
              >
                {pending && <Spinner />} {mode === 'disable' ? 'Disable' : 'Generate codes'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- Sessions ----------
function describeAgent(ua: string | null) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}

function SessionsCard() {
  const { data, isLoading } = useSecurity();
  const revoke = useRevokeSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const [confirmAll, setConfirmAll] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>Devices currently signed in to your account.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {isLoading ? (
          <Skeleton className="h-16" />
        ) : (
          <ul className="grid gap-2">
            {data?.sessions.map((s) => (
              <li key={s.id} className="border-border flex items-center gap-3 rounded-md border p-3">
                <Monitor className="text-muted-foreground size-5 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium">
                    {describeAgent(s.userAgent)} {s.current && <Badge variant="success">This device</Badge>}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {s.ip ?? 'Unknown IP'} · signed in {formatDateTime(s.createdAt)} · active{' '}
                    {formatRelative(s.lastSeenAt)}
                  </p>
                </div>
                {!s.current && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      revoke.mutate(s.id, { onSuccess: () => toast.success('Session signed out') })
                    }
                  >
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" className="justify-self-start" onClick={() => setConfirmAll(true)}>
          <LogOut /> Sign out everywhere
        </Button>
        <ConfirmDialog
          open={confirmAll}
          onOpenChange={setConfirmAll}
          title="Sign out of all devices?"
          description="Every session, including this one, will be ended. You will need to sign in again."
          confirmLabel="Sign out everywhere"
          destructive
          pending={logout.isPending}
          onConfirm={() => logout.mutate(true, { onSettled: () => navigate('/login', { replace: true }) })}
        />
      </CardContent>
    </Card>
  );
}

const EVENT_LABELS: Record<string, string> = {
  'auth.login.success': 'Signed in',
  'auth.login.failure': 'Failed sign-in attempt',
  'auth.mfa.failure': 'Failed two-factor code',
  'auth.logout': 'Signed out',
  'auth.logout_all': 'Signed out everywhere',
  'auth.session_revoked': 'Session revoked',
  'auth.password_changed': 'Password changed',
  'auth.mfa_enabled': 'Two-factor enabled',
  'auth.mfa_disabled': 'Two-factor disabled',
  'auth.recovery_codes_regenerated': 'Recovery codes regenerated',
  'auth.recovery_code_used': 'Recovery code used',
  'account.updated': 'Account details updated',
  'notes.permanently_deleted': 'Notes permanently deleted',
  'module.deleted': 'Module deleted',
  'data.exported': 'Full export downloaded',
  'data.imported': 'Markdown imported',
};

function EventsCard() {
  const { data, isLoading } = useSecurityEvents();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent security activity</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : !data?.length ? (
          <p className="text-muted-foreground text-sm">No activity yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-left text-xs">
                  <th className="py-2 pr-4 font-medium">Event</th>
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 font-medium">IP address</th>
                </tr>
              </thead>
              <tbody>
                {data.slice(0, 20).map((e) => (
                  <tr key={e.id} className="border-border border-t">
                    <td className={e.type.includes('failure') ? 'text-danger py-2 pr-4' : 'py-2 pr-4'}>
                      {EVENT_LABELS[e.type] ?? e.type}
                    </td>
                    <td className="text-muted-foreground py-2 pr-4 whitespace-nowrap">
                      {formatDateTime(e.createdAt)}
                    </td>
                    <td className="text-muted-foreground py-2 font-mono text-xs">{e.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
