'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Page } from '@/components/shell/app-shell';
import { Button } from '@/components/ui/button';
import { Feedback, Loading } from '@/components/ui/feedback';
import { WorkFailure } from '@/components/work/work-frame';
import { apiRequest, naira, shortDate } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import {
  pointsSummary,
  purchasePage,
  releaseResult,
  withdrawalPage,
} from '@/lib/rewards';
import { useApiRead } from '@/lib/use-api-read';
import { WithdrawalList, WithdrawPanel } from './withdraw';

const stateLabel = {
  pending: ['Held', 'chip chip-pending'],
  releasable: ['Ready', 'chip chip-ready'],
  released: ['In wallet', 'chip chip-done'],
  voided: ['Withdrawn by business', 'chip chip-muted'],
} as const;

export function Wallet() {
  const summary = useApiRead('points', pointsSummary);
  const purchases = useApiRead('purchases?limit=30', purchasePage);
  const withdrawals = useApiRead('wallet/withdrawals?limit=10', withdrawalPage);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [notice, setNotice] = useState('');

  async function release(id: string) {
    if (busy) return;
    setBusy(id);
    setError('');
    try {
      // Releasing is idempotent: repeating it never pays twice.
      await apiRequest(`purchases/${id}/releases`, releaseResult, {
        method: 'POST',
        body: {},
      });
    } catch (cause) {
      setError(
        cause instanceof RequestError && cause.code === 'not_releasable'
          ? 'This cash back is not ready yet, or the business withdrew it.'
          : 'We could not confirm the transfer. Check your connection and try again; it will never pay twice.',
      );
    } finally {
      setBusy(null);
      summary.refresh();
      purchases.refresh();
    }
  }

  const held = (purchases.data?.items ?? [])
    .filter((p) => p.state === 'pending' || p.state === 'releasable')
    .reduce((sum, p) => sum + BigInt(p.cashbackKobo), 0n);
  const data = summary.data;
  const tier = data?.tier;
  const progress =
    tier?.next && tier.next.businesses > 0
      ? Math.min(1, tier.businesses / tier.next.businesses)
      : 1;
  return (
    <Page eyebrow="Wallet" title="Your money">
      {summary.loading && !data ? (
        <Loading>Loading your wallet…</Loading>
      ) : summary.error && !data ? (
        <WorkFailure error={summary.error} retry={summary.refresh} />
      ) : (
        data && (
          <div className="grid gap-6">
            <section
              className="grid gap-3"
              style={{
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
              }}
            >
              <div
                className="card"
                style={{
                  background: 'var(--color-ink)',
                  color: 'var(--color-surface)',
                  borderColor: 'var(--color-ink)',
                }}
              >
                <p
                  className="eyebrow"
                  style={{
                    color:
                      'color-mix(in srgb, var(--color-surface) 70%, transparent)',
                  }}
                >
                  In your wallet
                </p>
                <p
                  className="amount amount-xl"
                  style={{ margin: '0.25rem 0 0.75rem' }}
                >
                  {naira(data.walletKobo)}
                </p>
                {data.phoneVerified && BigInt(data.walletKobo) >= 50000n ? (
                  <Button
                    type="button"
                    className="button-lime"
                    aria-expanded={withdrawing}
                    aria-controls="withdraw-panel"
                    onClick={() => {
                      setWithdrawing(true);
                      setNotice('');
                    }}
                  >
                    Withdraw
                  </Button>
                ) : (
                  <p
                    className="small-note"
                    style={{
                      color:
                        'color-mix(in srgb, var(--color-surface) 70%, transparent)',
                    }}
                  >
                    {data.phoneVerified ? (
                      'You can withdraw once you have ₦500 or more.'
                    ) : (
                      <>
                        Withdrawing needs a verified phone number.{' '}
                        <Link
                          href="/verify-phone?next=/wallet"
                          style={{ color: 'var(--color-lime)' }}
                        >
                          Verify your phone
                        </Link>
                      </>
                    )}
                  </p>
                )}
              </div>
              <div className="card">
                <p className="eyebrow">Held cash back</p>
                <p
                  className="amount amount-xl amount-pending"
                  style={{ margin: '0.25rem 0 0.75rem' }}
                >
                  {naira(held.toString())}
                </p>
                <p className="small-note">
                  Held during each business&apos;s refund window. Not yet yours
                  to spend.
                </p>
              </div>
            </section>

            {withdrawing && (
              <div id="withdraw-panel">
                <WithdrawPanel
                  walletKobo={data.walletKobo}
                  onCancel={() => setWithdrawing(false)}
                  onDone={(result) => {
                    setWithdrawing(false);
                    setNotice(
                      `${naira(result.amountKobo)} is on its way. It shows as processing until the payment provider confirms it.`,
                    );
                    summary.refresh();
                    withdrawals.refresh();
                  }}
                />
              </div>
            )}
            {notice && <Feedback>{notice}</Feedback>}
            {error && <Feedback error>{error}</Feedback>}

            <section aria-labelledby="purchases-heading">
              <h2 id="purchases-heading">Cash back</h2>
              {purchases.loading && !purchases.data ? (
                <Loading>Loading cash back…</Loading>
              ) : purchases.data?.items.length ? (
                <ul className="stack">
                  {purchases.data.items.map((item) => {
                    const [text, chip] = stateLabel[item.state];
                    return (
                      <li
                        key={item.id}
                        className="card row"
                        style={{ flexWrap: 'wrap' }}
                      >
                        <div style={{ minWidth: 0, flex: '1 1 12rem' }}>
                          <p
                            className="truncate"
                            style={{ margin: 0, fontWeight: 600 }}
                          >
                            {item.businessName}
                          </p>
                          <p className="small-note truncate">
                            {item.state === 'pending'
                              ? `Unlocks ${shortDate(item.releaseAt)}`
                              : `Bought ${shortDate(item.createdAt)}`}
                          </p>
                        </div>
                        <div
                          className="row"
                          style={{ justifyContent: 'flex-end' }}
                        >
                          <span
                            className={`amount ${item.state === 'pending' ? 'amount-pending' : ''}`}
                            style={
                              item.state === 'voided'
                                ? {
                                    textDecoration: 'line-through',
                                    color: 'var(--color-muted)',
                                  }
                                : undefined
                            }
                          >
                            {naira(item.cashbackKobo)}
                          </span>
                          {item.state === 'releasable' ? (
                            <Button
                              variant="accent"
                              type="button"
                              disabled={busy !== null}
                              onClick={() => void release(item.id)}
                            >
                              {busy === item.id ? 'Moving…' : 'Move to wallet'}
                            </Button>
                          ) : (
                            <span className={chip}>{text}</span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="small-note">
                  No cash back yet. <Link href="/offers">Find an offer</Link>.
                </p>
              )}
            </section>

            {withdrawals.data?.items.length ? (
              <WithdrawalList items={withdrawals.data.items} />
            ) : null}

            <section
              className="grid gap-3"
              style={{
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
              }}
            >
              <div className="card grid gap-2">
                <p className="eyebrow">Points</p>
                <p style={{ margin: 0 }}>
                  <span className="amount" style={{ fontSize: '1.8rem' }}>
                    {BigInt(data.points.available).toLocaleString('en-NG')}
                  </span>{' '}
                  <span className="small-note">available</span>
                </p>
                <p className="small-note num">
                  {BigInt(data.points.pending).toLocaleString('en-NG')} pending
                  · points are not cash
                </p>
              </div>
              <div className="card grid gap-2">
                <p className="eyebrow">Tier</p>
                <p
                  style={{
                    margin: 0,
                    fontFamily: 'var(--font-heading)',
                    fontSize: '1.6rem',
                    fontWeight: 700,
                  }}
                >
                  {data.tier.name}
                </p>
                {data.tier.next ? (
                  <>
                    <div
                      className="countdown-track"
                      role="progressbar"
                      aria-label={`Progress to ${data.tier.next.name}`}
                      aria-valuemin={0}
                      aria-valuemax={data.tier.next.businesses}
                      aria-valuenow={data.tier.businesses}
                    >
                      <div
                        className="countdown-fill"
                        style={{ transform: `scaleX(${progress})` }}
                      />
                    </div>
                    <p className="small-note num">
                      {data.tier.businesses} of {data.tier.next.businesses}{' '}
                      different businesses for {data.tier.next.name}
                    </p>
                  </>
                ) : (
                  <p className="small-note">Highest tier reached.</p>
                )}
              </div>
            </section>
            <p className="small-note">
              Won a prize code? <Link href="/claim">Claim it here</Link>.
            </p>
          </div>
        )
      )}
    </Page>
  );
}
