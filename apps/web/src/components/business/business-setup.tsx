'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { z } from 'zod';
import { DashHead, DashShell } from './dash-shell';
import { Button } from '@/components/ui/button';
import { Feedback, Loading } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { WorkFailure } from '@/components/work/work-frame';
import { apiRequest } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { businessRules } from '@/lib/business-rules';
import { useApiRead } from '@/lib/use-api-read';

const terms = z.object({ version: z.string().nullable() });
const profile = z.object({ id: z.uuid(), name: z.string() });

function setupError(error: unknown) {
  if (error instanceof RequestError) {
    if (error.status === 403)
      return 'Verify your email and finish setting up your account first.';
    if (error.status === 409)
      return 'This account already has a business with another name, or the terms changed. Reload and try again.';
    if (error.status === 400)
      return 'Enter your business name (up to 120 characters).';
  }
  return 'We could not create your business. Check your connection and try again; it will not be created twice.';
}

export function BusinessSetup() {
  const router = useRouter();
  const current = useApiRead('sponsor/terms', terms);
  const [name, setName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const version = current.data?.version;
    if (busy || !version) return;
    if (!name.trim()) {
      setInvalid('Enter your business name.');
      return;
    }
    if (!accepted) {
      setError('Accept the business terms to continue.');
      return;
    }
    setBusy(true);
    setError('');
    setInvalid('');
    try {
      // Creating the same business again returns it, so a retry is safe.
      await apiRequest('sponsor/profile', profile, {
        method: 'POST',
        body: { name: name.trim(), acceptTerms: true, termsVersion: version },
      });
      router.push('/business/funds');
    } catch (cause) {
      setError(setupError(cause));
      setBusy(false);
    }
  }

  return (
    <DashShell
      crumbs={[{ label: 'Business', href: '/business' }, { label: 'Set up' }]}
    >
      <DashHead
        title="Set up your business"
        intro="Run cash back offers and prize promotions that pay real customers."
      />
      {current.loading && !current.data ? (
        <Loading>Loading…</Loading>
      ) : current.error && !current.data ? (
        <WorkFailure error={current.error} retry={current.refresh} />
      ) : current.data && !current.data.version ? (
        <section className="card grid gap-3" style={{ maxWidth: 620 }}>
          <h2 style={{ margin: 0 }}>Business accounts open soon</h2>
          <p className="small-note">
            Acticlaim opens business accounts once its business terms are
            published. Nothing is charged before then.
          </p>
        </section>
      ) : (
        current.data && (
          <div className="dash-grid">
            <form
              className="card grid gap-4"
              onSubmit={submit}
              noValidate
              aria-labelledby="setup-heading"
            >
              <h2 id="setup-heading" style={{ margin: 0 }}>
                Your business
              </h2>
              <Field
                id="business-name"
                label="Business name"
                autoComplete="organization"
                maxLength={120}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setInvalid('');
                }}
                hint="Shown to shoppers on your offers, exactly as typed."
                error={invalid}
              />
              <label className="work-consent">
                <input
                  type="checkbox"
                  checked={accepted}
                  disabled={busy}
                  onChange={(e) => {
                    setAccepted(e.target.checked);
                    setError('');
                  }}
                />
                <span>
                  I accept the{' '}
                  <Link className="text-link" href="/terms/business">
                    Acticlaim business terms
                  </Link>{' '}
                  (version {current.data.version}).
                </span>
              </label>
              {error && <Feedback error>{error}</Feedback>}
              <Button variant="accent" type="submit" loading={busy}>
                {busy ? 'Creating your business…' : 'Create business'}
              </Button>
            </form>
            <section className="card" aria-labelledby="rules-heading">
              <div className="card-head">
                <h2 id="rules-heading">What you are agreeing to</h2>
                <p>The short version. The terms page has the full text.</p>
              </div>
              <ol className="timeline">
                {businessRules.map((rule) => (
                  <li key={rule}>
                    <span style={{ color: 'var(--color-ink)' }}>{rule}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )
      )}
    </DashShell>
  );
}
