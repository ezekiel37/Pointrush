'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Copy, ShieldCheck } from 'lucide-react';
import { AuthFrame } from './auth-frame';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Form } from '@/components/ui/form';
import { authClient, requireSuccess } from '@/lib/auth-client';
import { useSubmit } from '@/lib/use-submit';

type Setup = { totpURI: string; backupCodes: string[] };

export function TwoFactorScreen() {
  const router = useRouter();
  const query = useSearchParams();
  const enrollment = query.get('mode') === 'enroll';
  const submit = useSubmit();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [backup, setBackup] = useState(false);
  const [copied, setCopied] = useState(false);

  const title = enrollment
    ? setup
      ? 'Confirm your authenticator'
      : 'Protect reviewer access'
    : 'One more security step';
  const description = enrollment
    ? setup
      ? 'Enter the six-digit code shown by your authenticator app.'
      : 'Reviewer accounts must use an authenticator app before sensitive review work is available.'
    : 'Enter a code from your authenticator app to finish signing in.';

  async function copySetupUri() {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.totpURI);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function verify(code: string) {
    return submit.run(async () => {
      if (backup) {
        requireSuccess(await authClient().twoFactor.verifyBackupCode({ code }));
      } else {
        requireSuccess(await authClient().twoFactor.verifyTotp({ code }));
      }
      router.replace('/account');
    });
  }

  if (enrollment && !setup)
    return (
      <AuthFrame
        title={title}
        description={description}
        step={1}
        journeyLabels={['Confirm identity', 'Add authenticator', 'Verify code']}
        journeyLabel="Authenticator setup steps"
      >
        <div className="security-intro">
          <ShieldCheck size={24} aria-hidden />
          <p>
            This setup is for appointed Acticlaim reviewers. Your authenticator
            secret is shown only during setup. Save the backup codes privately
            before you continue.
          </p>
        </div>
        <Form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const password = String(form.get('password') ?? '');
            submit.run(async () => {
              const result = await authClient().twoFactor.enable({
                password,
                method: 'totp',
              });
              requireSuccess(result);
              if (
                !result.data ||
                result.data.method !== 'totp' ||
                !result.data.totpURI ||
                !result.data.backupCodes.length
              )
                throw new Error('Authenticator setup is incomplete');
              setSetup({
                totpURI: result.data.totpURI,
                backupCodes: result.data.backupCodes,
              });
            });
          }}
          aria-busy={submit.busy}
        >
          <Field
            id="password"
            name="password"
            label="Current password"
            type="password"
            autoComplete="current-password"
            maxLength={128}
            hint="We need this before creating a new authenticator setup."
          />
          {submit.error && <Feedback error>{submit.error}</Feedback>}
          <Button className="full-width" type="submit" loading={submit.busy}>
            {submit.busy ? 'Preparing setup…' : 'Continue'}
            <ArrowRight size={18} aria-hidden />
          </Button>
        </Form>
        <Link className="text-link" href="/account">
          Return to account
        </Link>
      </AuthFrame>
    );

  if (enrollment && setup)
    return (
      <AuthFrame
        title={title}
        description={description}
        step={2}
        journeyLabels={['Confirm identity', 'Add authenticator', 'Verify code']}
        journeyLabel="Authenticator setup steps"
      >
        <section className="mfa-setup" aria-labelledby="setup-heading">
          <h2 id="setup-heading">Add Acticlaim to your app</h2>
          <p>
            In your authenticator app, add a new account and choose manual
            setup. Copy this link into the app if it supports importing an
            otpauth link; otherwise use the app&apos;s manual secret-entry
            option.
          </p>
          <div
            className="setup-uri"
            tabIndex={0}
            aria-label="Authenticator setup link"
          >
            {setup.totpURI}
          </div>
          <Button variant="outline" type="button" onClick={copySetupUri}>
            <Copy size={17} aria-hidden />
            {copied ? 'Copied' : 'Copy setup link'}
          </Button>
          <div className="backup-codes">
            <h3>Save your backup codes</h3>
            <p>
              Keep these somewhere private. They can help you sign in if you
              lose your authenticator, but they do not unlock reviewer access by
              themselves.
            </p>
            <code>{setup.backupCodes.join(' · ')}</code>
          </div>
        </section>
        <VerificationForm
          backup={false}
          busy={submit.busy}
          error={submit.error}
          onSubmit={verify}
        />
      </AuthFrame>
    );

  return (
    <AuthFrame
      title={title}
      description={description}
      step={2}
      journeyLabels={['Sign in', 'Verify code', 'Continue']}
      journeyLabel="Sign-in security steps"
    >
      <VerificationForm
        backup={backup}
        busy={submit.busy}
        error={submit.error}
        onSubmit={verify}
      />
      <Button
        variant="ghost"
        type="button"
        onClick={() => setBackup((value) => !value)}
        loading={submit.busy}
      >
        {backup ? 'Use authenticator code' : 'Use a backup code'}
      </Button>
      <p className="small-note">
        Backup-code sign-in does not unlock reviewer actions. You will still
        need an authenticator step-up before reviewing tasks.
      </p>
    </AuthFrame>
  );
}

function VerificationForm({
  backup,
  busy,
  error,
  onSubmit,
}: {
  backup: boolean;
  busy: boolean;
  error: string;
  onSubmit: (code: string) => void;
}) {
  const [validationError, setValidationError] = useState('');
  return (
    <Form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const code = String(form.get('code') ?? '').trim();
        if (backup ? !code : !/^\d{6}$/.test(code)) {
          setValidationError(
            backup
              ? 'Enter a backup code.'
              : 'Enter the six-digit code from your authenticator app.',
          );
          return;
        }
        setValidationError('');
        onSubmit(code);
      }}
      aria-busy={busy}
    >
      <Field
        id="code"
        name="code"
        label={backup ? 'Backup code' : 'Authenticator code'}
        type="text"
        inputMode={backup ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        maxLength={backup ? 32 : 6}
        pattern={backup ? undefined : '[0-9]{6}'}
        error={validationError}
        hint={
          backup
            ? 'Enter one unused backup code.'
            : 'Enter the six-digit code currently shown in your app.'
        }
      />
      {(validationError || error) && (
        <Feedback error>{validationError || error}</Feedback>
      )}
      <Button className="full-width" type="submit" loading={busy}>
        {busy ? 'Checking code…' : 'Verify code'}
        <ArrowRight size={18} aria-hidden />
      </Button>
    </Form>
  );
}
