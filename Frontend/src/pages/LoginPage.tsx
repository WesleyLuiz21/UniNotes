import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useSearchParams } from 'react-router';
import { Eye, EyeOff, KeyRound, LogIn } from 'lucide-react';
import { z } from 'zod';
import { useLogin, useMfaLogin, useSession } from '@/api/auth';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/misc';
import { safeNext } from '@/components/layout/Guards';
import { LogoMark } from '@/components/layout/Logo';
import { errorMessage } from '@/lib/api';

const LoginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your username or email'),
  password: z.string().min(1, 'Enter your password'),
});
const MfaSchema = z.object({
  code: z.string().trim().min(6, 'Enter the 6-digit code or a recovery code').max(20),
});

export function LoginPage() {
  const { data } = useSession();
  const [step, setStep] = useState<'password' | 'mfa'>(data?.status === 'mfa_required' ? 'mfa' : 'password');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const done = () => navigate(safeNext(params.get('next')), { replace: true });

  useEffect(() => {
    document.title = 'Sign in · UniNotes';
  }, []);

  return (
    <div className="bg-background grid min-h-dvh place-items-center px-4 py-10">
      <main className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <LogoMark className="size-11" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">UniNotes</h1>
            <p className="text-muted-foreground mt-1 text-sm">Your private lecture notes workspace</p>
          </div>
        </div>
        <div className="border-border bg-surface rounded-xl border p-6 shadow-sm">
          {step === 'password' ? (
            <PasswordStep onMfa={() => setStep('mfa')} onDone={done} />
          ) : (
            <MfaStep onDone={done} onBack={() => setStep('password')} />
          )}
        </div>
      </main>
    </div>
  );
}

function PasswordStep({ onMfa, onDone }: { onMfa: () => void; onDone: () => void }) {
  const login = useLogin();
  const [show, setShow] = useState(false);
  const form = useForm<z.infer<typeof LoginSchema>>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { identifier: '', password: '' },
  });
  const { errors } = form.formState;

  const submit = form.handleSubmit((values) =>
    login.mutate(values, {
      onSuccess: (s) => (s.status === 'mfa_required' ? onMfa() : onDone()),
      onError: () => form.setValue('password', ''),
    }),
  );

  return (
    <form onSubmit={submit} noValidate className="grid gap-4" aria-label="Sign in">
      <h2 className="text-lg font-semibold">Sign in</h2>
      {login.isError && (
        <p
          role="alert"
          className="border-danger/40 bg-danger/10 text-danger rounded-md border px-3 py-2 text-sm"
        >
          {errorMessage(login.error)}
        </p>
      )}
      <Field label="Username or email" htmlFor="identifier" error={errors.identifier?.message}>
        <Input
          id="identifier"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          aria-invalid={Boolean(errors.identifier)}
          aria-describedby={errors.identifier ? 'identifier-error' : undefined}
          {...form.register('identifier')}
        />
      </Field>
      <Field label="Password" htmlFor="password" error={errors.password?.message}>
        <div className="relative">
          <Input
            id="password"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            className="pr-10"
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? 'password-error' : undefined}
            {...form.register('password')}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md"
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Field>
      <Button type="submit" size="lg" disabled={login.isPending} className="mt-1">
        {login.isPending ? <Spinner /> : <LogIn />}
        {login.isPending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}

function MfaStep({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const mfa = useMfaLogin();
  const form = useForm<z.infer<typeof MfaSchema>>({
    resolver: zodResolver(MfaSchema),
    defaultValues: { code: '' },
  });
  const { errors } = form.formState;
  const submit = form.handleSubmit(({ code }) =>
    mfa.mutate(code, {
      onSuccess: onDone,
      onError: () => form.setValue('code', ''),
    }),
  );
  return (
    <form onSubmit={submit} noValidate className="grid gap-4" aria-label="Two-factor authentication">
      <div className="flex items-center gap-2">
        <KeyRound className="text-accent size-5" aria-hidden />
        <h2 className="text-lg font-semibold">Two-factor authentication</h2>
      </div>
      <p className="text-muted-foreground text-sm">
        Enter the code from your authenticator app, or one of your recovery codes.
      </p>
      {mfa.isError && (
        <p
          role="alert"
          className="border-danger/40 bg-danger/10 text-danger rounded-md border px-3 py-2 text-sm"
        >
          {errorMessage(mfa.error)}
        </p>
      )}
      <Field label="Authentication code" htmlFor="code" error={errors.code?.message}>
        <Input
          id="code"
          inputMode="text"
          autoComplete="one-time-code"
          autoFocus
          className="font-mono tracking-widest"
          aria-invalid={Boolean(errors.code)}
          {...form.register('code')}
        />
      </Field>
      <Button type="submit" size="lg" disabled={mfa.isPending}>
        {mfa.isPending ? <Spinner /> : null}
        Verify
      </Button>
      <Button variant="link" onClick={onBack} className="justify-self-center text-sm">
        Use a different account
      </Button>
    </form>
  );
}
