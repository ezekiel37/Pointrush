'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { PartyPopper } from 'lucide-react';
import { Page } from '@/components/shell/app-shell';
import { Button } from '@/components/ui/button';
import { Feedback, Loading } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { apiRequest, naira, newId, shortDate } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { claimList, claimResult } from '@/lib/rewards';
import type { z } from 'zod';
import { useApiRead } from '@/lib/use-api-read';

type Claimed = z.infer<typeof claimResult>;

function claimError(error: unknown) {
  if (error instanceof RequestError) {
    if (error.status === 401) return 'Sign in to claim a prize.';
    if (error.status === 400)
      return 'That does not look like a prize code. Codes have 16 letters and numbers, like AC-7K4M-9X2Q-PRDH-3VBN.';
    switch (error.code) {
      case 'claim_rejected':
        return 'This code cannot be claimed. Check each character. It may already be used, or the promotion may not be running.';
      case 'claim_limit':
        return 'You have already claimed the most prizes this promotion allows per person.';
      case 'claim_rate_limit':
        return 'Too many codes did not work. For your security, try again in an hour.';
      case 'phone_required':
        return 'Verify your phone number to claim prizes. Your code stays valid.';
    }
    if (error.status === 403)
      return 'Your account cannot claim prizes right now. Check your account status.';
  }
  return 'We could not confirm your claim. Check your connection and try again. Trying again will never claim twice.';
}
// A definitive answer ends the attempt; a lost response keeps its ID for retry.
const definitive = (error: unknown) =>
  error instanceof RequestError && error.status >= 400 && error.status < 500;

export function PrizeClaimScreen() {
  const params = useSearchParams();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [won, setWon] = useState<Claimed | null>(null);
  const attempt = useRef<{ id: string; code: string } | null>(null);
  const history = useApiRead('claims?limit=10', claimList);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const value = code.trim();
    if (!value) {
      setError('Enter the code printed under the scratch panel.');
      return;
    }
    if (attempt.current?.code !== value)
      attempt.current = { id: newId(), code: value };
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest('claims', claimResult, {
        method: 'POST',
        body: attempt.current,
      });
      attempt.current = null;
      setWon(result);
      setCode('');
      history.refresh();
    } catch (cause) {
      if (definitive(cause)) attempt.current = null;
      setError(claimError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      eyebrow="Prize codes"
      title="Claim a prize"
      intro="Scratched a winning code? Enter it here. Every prize is paid from money the business locked before the promotion started."
    >
      <div className="grid gap-6" style={{ maxWidth: 560 }}>
        {won ? (
          <section className="prize" aria-live="polite">
            <PartyPopper aria-hidden size={28} />
            <p className="eyebrow" style={{ marginTop: '0.75rem' }}>
              {won.businessName} · {won.title}
            </p>
            <span className="amount amount-xl">{naira(won.prizeKobo)}</span>
            <p>Added to your wallet. This code is now used.</p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button asChild>
                <Link href="/wallet">Open wallet</Link>
              </Button>
              <Button variant="outline" onClick={() => setWon(null)}>
                Claim another code
              </Button>
            </div>
          </section>
        ) : (
          <form className="card grid gap-4" onSubmit={submit} noValidate>
            <Field
              id="claim-code"
              label="Prize code"
              hint="Letters and numbers only. Dashes and spaces are optional."
              placeholder="AC-XXXX-XXXX-XXXX-XXXX"
              className="input-code"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              disabled={busy}
            />
            {error && (
              <Feedback error>
                {error}
                {error.startsWith('Verify your phone') && (
                  <>
                    {' '}
                    <Link
                      className="text-link"
                      href={`/verify-phone?next=${encodeURIComponent('/claim')}`}
                    >
                      Verify now
                    </Link>
                  </>
                )}
              </Feedback>
            )}
            <Button variant="accent" type="submit" disabled={busy}>
              {busy ? 'Checking code…' : 'Claim prize'}
            </Button>
          </form>
        )}
        <section aria-labelledby="claimed-heading">
          <h2 id="claimed-heading">Your prizes</h2>
          {history.loading && !history.data ? (
            <Loading>Loading your prizes…</Loading>
          ) : history.data?.items.length ? (
            <ul className="stack">
              {history.data.items.map((item) => (
                <li key={item.id} className="card row">
                  <div>
                    <p
                      className="truncate"
                      style={{ margin: 0, fontWeight: 600 }}
                    >
                      {item.businessName}
                    </p>
                    <p className="small-note truncate">
                      {item.title} · {shortDate(item.claimedAt)}
                    </p>
                  </div>
                  <span className="amount">{naira(item.prizeKobo)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small-note">
              {history.error
                ? 'Sign in to see the prizes you have claimed.'
                : 'Prizes you claim will appear here.'}
            </p>
          )}
        </section>
      </div>
    </Page>
  );
}
