'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { BadgeCheck } from 'lucide-react';
import { z } from 'zod';
import { Page } from '@/components/shell/app-shell';
import { Button } from '@/components/ui/button';
import { Feedback, Loading } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { WorkFailure } from '@/components/work/work-frame';
import { apiRequest } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { useApiRead } from '@/lib/use-api-read';

const status = z.object({
  verified: z.boolean(),
  phone: z.string().nullable(),
});
const challenge = z.object({
  challengeId: z.uuid(),
  phone: z.string(),
  expiresAt: z.iso.datetime({ offset: true }),
  resendAt: z.iso.datetime({ offset: true }),
});
const verified = z.object({ verified: z.literal(true), phone: z.string() });
type Challenge = z.infer<typeof challenge>;

// Only same-site paths, so the link cannot send people elsewhere.
const safeNext = (value: string | null) =>
  value && /^\/[a-z0-9/_-]*$/i.test(value) ? value : '/wallet';

function sendError(error: unknown) {
  if (error instanceof RequestError) {
    switch (error.code) {
      case 'phone_unavailable':
        return error.status === 503
          ? 'Phone verification is not available yet. Your account and balance are safe.'
          : 'This number cannot be used. It may already belong to another account.';
      case 'country_unsupported':
        return 'We can only send codes to Nigerian numbers for now.';
      case 'code_cooldown':
        return 'Wait a minute before asking for another code.';
      case 'code_limit':
        return 'Too many codes requested today. Try again tomorrow.';
      case 'sms_busy':
        return 'Verification is busy right now. Try again later.';
      case 'sms_failed':
        return 'We could not send the text. Check the number and try again in a minute.';
    }
    if (error.status === 400)
      return 'Enter a Nigerian mobile number, like 0803 123 4567.';
  }
  return 'We could not send a code. Check your connection and try again.';
}
function verifyError(error: unknown) {
  if (error instanceof RequestError) {
    if (error.code === 'code_wrong')
      return 'That code is not right. Check the text and try again.';
    if (error.code === 'code_expired' || error.status === 404)
      return 'This code no longer works. Ask for a new one.';
    if (error.status === 400) return 'Enter the 6 digits from the text.';
  }
  return 'We could not check the code. Check your connection and try again.';
}

function useSecondsUntil(target: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [target]);
  return target ? Math.max(0, Math.ceil((Date.parse(target) - now) / 1000)) : 0;
}

export function VerifyPhone() {
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const current = useApiRead('phone', status);
  const [number, setNumber] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<Challenge | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const wait = useSecondsUntil(sent?.resendAt ?? null);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    if (!number.trim()) {
      setError('Enter your mobile number.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest('phone/challenges', challenge, {
        method: 'POST',
        body: { phoneNumber: number.trim() },
      });
      setSent(result);
      setCode('');
    } catch (cause) {
      setError(sendError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (busy || !sent) return;
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6 digits from the text.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest('phone/verifications', verified, {
        method: 'POST',
        body: { challengeId: sent.challengeId, code },
      });
      setDone(result.phone);
    } catch (cause) {
      setError(verifyError(cause));
    } finally {
      setBusy(false);
    }
  }

  const phone = done ?? (current.data?.verified ? current.data.phone : null);
  return (
    <Page
      eyebrow="Account"
      title="Verify your phone"
      intro="One verified number per person keeps prizes, referrals and withdrawals fair."
    >
      <div className="card grid gap-4" style={{ maxWidth: 520 }}>
        {current.loading && !current.data ? (
          <Loading>Checking your account…</Loading>
        ) : current.error && !current.data ? (
          <WorkFailure error={current.error} retry={current.refresh} />
        ) : phone ? (
          <>
            <p className="icon-line" style={{ margin: 0, fontWeight: 600 }}>
              <BadgeCheck
                size={20}
                aria-hidden
                style={{ color: 'var(--color-brand-text)' }}
              />
              {phone} is verified
            </p>
            <p className="small-note">
              You can now claim prizes, earn referral rewards and withdraw.
            </p>
            <Link
              className="button button-accent"
              href={next}
              style={{ justifySelf: 'start' }}
            >
              Continue
            </Link>
          </>
        ) : !sent ? (
          <form className="grid gap-4" onSubmit={send} noValidate>
            <Field
              id="phone-number"
              label="Mobile number"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="0803 123 4567"
              value={number}
              onChange={(e) => {
                setNumber(e.target.value);
                setError('');
              }}
              hint="We send a 6-digit code by text. Receiving it is free."
            />
            {error && <Feedback error>{error}</Feedback>}
            <Button variant="accent" type="submit" disabled={busy}>
              {busy ? 'Sending code…' : 'Send code'}
            </Button>
          </form>
        ) : (
          <form className="grid gap-4" onSubmit={verify} noValidate>
            <p className="small-note" style={{ margin: 0 }}>
              We sent a code to <strong>{sent.phone}</strong>. It works for 10
              minutes.
            </p>
            <Field
              id="phone-code"
              label="6-digit code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="input-code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, ''));
                setError('');
              }}
            />
            {error && <Feedback error>{error}</Feedback>}
            <Button variant="accent" type="submit" disabled={busy}>
              {busy ? 'Checking…' : 'Verify'}
            </Button>
            <div className="row" style={{ justifyContent: 'flex-start' }}>
              <Button
                type="button"
                variant="ghost"
                disabled={busy || wait > 0}
                onClick={() => void send()}
              >
                {wait > 0 ? `Send again in ${wait}s` : 'Send a new code'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setSent(null);
                  setError('');
                }}
              >
                Change number
              </Button>
            </div>
          </form>
        )}
      </div>
    </Page>
  );
}
