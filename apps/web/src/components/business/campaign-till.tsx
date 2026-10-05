'use client';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { CheckCircle2, Undo2 } from 'lucide-react';
import type { z } from 'zod';
import { DashHead, DashShell } from './dash-shell';
import { Button } from '@/components/ui/button';
import { Feedback, Loading } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { WorkFailure } from '@/components/work/work-frame';
import { apiRequest, naira, newId, shortDate, toKobo } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { campaignSummary, confirmation, voidResult } from '@/lib/rewards';
import { useApiRead } from '@/lib/use-api-read';
import { CodeScanner } from './code-scanner';

type Confirmed = z.infer<typeof confirmation>;
const stateLabel = {
  pending: ['Held', 'chip chip-pending'],
  releasable: ['Unlocked', 'chip chip-ready'],
  released: ['Paid', 'chip chip-done'],
  voided: ['Voided', 'chip chip-muted'],
} as const;

function tillError(error: unknown) {
  if (error instanceof RequestError) {
    if (error.status === 400)
      return 'Check the code and amount. Codes have 10 characters, like 7K4M2-PRDH9.';
    switch (error.code) {
      case 'confirmation_rejected':
        return 'This code is not valid here. It may have expired (codes last 15 minutes), belong to another offer, or the amount is below the minimum spend. Ask the shopper to refresh their code.';
      case 'campaign_full':
        return 'All cash back places for this offer are used.';
      case 'daily_limit':
        return 'This shopper has reached the daily limit of offers. No cash back is recorded.';
      case 'not_eligible':
        return 'This code was already used, or this shopper already has this offer.';
    }
    if (error.status === 404)
      return 'Only the business owner can confirm purchases here.';
  }
  return 'We could not confirm the result. Check your connection and confirm again. Retrying never records a purchase twice.';
}
const definitive = (error: unknown) =>
  error instanceof RequestError && error.status >= 400 && error.status < 500;

export function CampaignTill({ id }: { id: string }) {
  const summary = useApiRead(
    `campaigns/${id}/summary?limit=20`,
    campaignSummary,
  );
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Confirmed | null>(null);
  // A lost response keeps the same ID, so confirming again cannot double-count.
  const attempt = useRef<{
    id: string;
    code: string;
    amountKobo: string;
  } | null>(null);
  const onScan = useCallback((value: string) => setCode(value), []);

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const kobo = toKobo(amount);
    if (!code.trim() || !kobo) {
      setError(
        !code.trim()
          ? "Enter or scan the shopper's code."
          : 'Enter the amount paid in naira, for example 4500 or 4,500.50.',
      );
      return;
    }
    const value = { code: code.trim(), amountKobo: kobo };
    if (
      attempt.current?.code !== value.code ||
      attempt.current.amountKobo !== value.amountKobo
    )
      attempt.current = { id: newId(), ...value };
    setBusy(true);
    setError('');
    setDone(null);
    try {
      const result = await apiRequest(
        `campaigns/${id}/confirmations`,
        confirmation,
        {
          method: 'POST',
          body: attempt.current,
        },
      );
      attempt.current = null;
      setDone(result);
      setCode('');
      setAmount('');
      summary.refresh();
    } catch (cause) {
      if (definitive(cause)) attempt.current = null;
      setError(tillError(cause));
    } finally {
      setBusy(false);
    }
  }

  const [voiding, setVoiding] = useState<{ id: string; reason: string } | null>(
    null,
  );
  async function voidPurchase(event: FormEvent) {
    event.preventDefault();
    if (!voiding?.reason.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(`purchases/${voiding.id}/voids`, voidResult, {
        method: 'POST',
        body: { reason: voiding.reason.trim() },
      });
      setVoiding(null);
    } catch (cause) {
      setError(
        cause instanceof RequestError && cause.code === 'void_rejected'
          ? 'This purchase can no longer be voided: its refund window has passed.'
          : cause instanceof RequestError && cause.code === 'void_limit'
            ? 'You have used all your voids for this campaign (20% of purchases). Contact Acticlaim support if there is a real problem.'
            : tillError(cause),
      );
    } finally {
      setBusy(false);
      summary.refresh();
    }
  }

  const data = summary.data;
  return (
    <DashShell
      crumbs={[
        { label: 'Business', href: '/business' },
        { label: 'Cash back', href: '/business/campaigns' },
        { label: data?.title ?? 'Campaign' },
      ]}
    >
      <DashHead
        title={data?.title ?? 'Campaign'}
        intro="Confirm purchases at the till and manage cash back."
      />
      {summary.loading && !data ? (
        <Loading>Loading campaign…</Loading>
      ) : summary.error && !data ? (
        <WorkFailure error={summary.error} retry={summary.refresh} />
      ) : (
        data && (
          <div className="grid gap-6">
            <dl className="stat-row" style={{ margin: 0 }}>
              <div className="stat">
                <dt>Places left</dt>
                <dd className="amount" style={{ fontSize: '1.6rem' }}>
                  {data.remaining}
                  <span className="small-note"> / {data.capacity}</span>
                </dd>
              </div>
              <div className="stat">
                <dt>Confirmed</dt>
                <dd className="amount" style={{ fontSize: '1.6rem' }}>
                  {data.confirmed - data.voided}
                </dd>
              </div>
              <div className="stat">
                <dt>Came back</dt>
                <dd className="amount" style={{ fontSize: '1.6rem' }}>
                  {data.returningShoppers}
                </dd>
              </div>
              <div className="stat">
                <dt>Cash back each</dt>
                <dd className="amount" style={{ fontSize: '1.6rem' }}>
                  {naira(data.cashbackKobo)}
                </dd>
              </div>
            </dl>
            <div className="till-grid">
              <form
                className="card grid gap-4 till-form"
                onSubmit={confirm}
                noValidate
              >
                <h2 style={{ margin: 0 }}>Confirm a purchase</h2>
                <CodeScanner onCode={onScan} />
                <Field
                  id="till-code"
                  label="Shopper's code"
                  placeholder="XXXXX-XXXXX"
                  className="input-code"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  disabled={busy}
                />
                <Field
                  id="till-amount"
                  label="Amount paid (₦)"
                  hint={
                    data.campaignTerms
                      ? `Minimum spend ${naira(data.campaignTerms.minSpendKobo)}`
                      : undefined
                  }
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  disabled={busy}
                />
                {error && <Feedback error>{error}</Feedback>}
                {done && (
                  <Feedback>
                    <strong>Purchase confirmed.</strong>{' '}
                    {naira(done.cashbackKobo)} cash back is held for the shopper
                    until {shortDate(done.releaseAt)}.
                  </Feedback>
                )}
                <Button variant="accent" type="submit" disabled={busy}>
                  <CheckCircle2 size={18} aria-hidden />
                  {busy ? 'Confirming…' : 'Confirm purchase'}
                </Button>
              </form>
              <section aria-labelledby="recent-heading">
                <h2 id="recent-heading">Recent purchases</h2>
                {data.recent.items.length ? (
                  <ul className="stack">
                    {data.recent.items.map((item) => {
                      const [label, chip] = stateLabel[item.state];
                      return (
                        <li
                          key={item.id}
                          className="card row"
                          style={{ flexWrap: 'wrap' }}
                        >
                          <div>
                            <p className="amount" style={{ margin: 0 }}>
                              {naira(item.amountKobo)}
                            </p>
                            <p className="small-note">
                              {shortDate(item.createdAt)}
                            </p>
                          </div>
                          <div
                            className="row"
                            style={{ justifyContent: 'flex-end' }}
                          >
                            <span className={chip}>{label}</span>
                            {item.state === 'pending' &&
                              data.voidsLeft > 0 &&
                              voiding?.id !== item.id && (
                                <Button
                                  variant="outline"
                                  type="button"
                                  onClick={() =>
                                    setVoiding({ id: item.id, reason: '' })
                                  }
                                >
                                  <Undo2 size={15} aria-hidden /> Void
                                </Button>
                              )}
                          </div>
                          {voiding?.id === item.id && (
                            <form
                              className="grid gap-3"
                              style={{ flexBasis: '100%' }}
                              onSubmit={voidPurchase}
                            >
                              <Field
                                id={`void-${item.id}`}
                                label="Reason for voiding"
                                hint={`The shopper sees your reason and can ask an Acticlaim reviewer to check it. The money stays locked for 7 days. Voids left: ${data.voidsLeft}.`}
                                placeholder="Refunded at the counter"
                                value={voiding.reason}
                                onChange={(event) =>
                                  setVoiding({
                                    id: item.id,
                                    reason: event.target.value,
                                  })
                                }
                                disabled={busy}
                              />
                              <div className="flex flex-wrap gap-3">
                                <Button
                                  type="submit"
                                  disabled={busy || !voiding.reason.trim()}
                                >
                                  Void cash back
                                </Button>
                                <Button
                                  variant="ghost"
                                  type="button"
                                  onClick={() => setVoiding(null)}
                                >
                                  Keep it
                                </Button>
                              </div>
                            </form>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="small-note">Confirmed purchases appear here.</p>
                )}
              </section>
            </div>
            <Link className="text-link" href="/business">
              All campaigns
            </Link>
          </div>
        )
      )}
    </DashShell>
  );
}
