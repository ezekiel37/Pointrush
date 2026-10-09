'use client';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, Check, Eye, EyeOff } from 'lucide-react';
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
  bankAccount,
} from '@/lib/rewards';
import { BankAccount, usable } from './bank-account';
import { useApiRead } from '@/lib/use-api-read';
import { minWithdrawKobo, WithdrawalList, WithdrawPanel } from './withdraw';
import { WithdrawalLock } from './withdrawal-lock';
import { VoidDispute } from './void-dispute';

const stateLabel = {
  pending: ['Held', 'chip chip-pending'],
  releasable: ['Ready', 'chip chip-ready'],
  released: ['In wallet', 'chip chip-done'],
  voided: ['Withdrawn by business', 'chip chip-muted'],
} as const;

const HIDE_KEY = 'acticlaim:hide-balances';

// Hides balances on this device (for example in public). Saved per device;
// if storage is blocked, the choice lasts until the page reloads.
const hideEvent = 'acticlaim:hide-balances';
let memoryHidden = false;
function readHidden() {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return memoryHidden;
  }
}
function subscribeHidden(notify: () => void) {
  window.addEventListener('storage', notify);
  window.addEventListener(hideEvent, notify);
  return () => {
    window.removeEventListener('storage', notify);
    window.removeEventListener(hideEvent, notify);
  };
}
function useHiddenBalances() {
  const hidden = useSyncExternalStore(subscribeHidden, readHidden, () => false);
  function toggle() {
    memoryHidden = !hidden;
    try {
      localStorage.setItem(HIDE_KEY, memoryHidden ? '1' : '0');
    } catch {
      // Storage blocked: memoryHidden carries the choice.
    }
    window.dispatchEvent(new Event(hideEvent));
  }
  return [hidden, toggle] as const;
}

function Step({
  done,
  title,
  children,
}: {
  done: boolean;
  title: string;
  children?: ReactNode;
}) {
  return (
    <li className={`ready-step ${done ? 'ready-step-done' : ''}`}>
      <span className="ready-step-mark" aria-hidden>
        {done && <Check size={14} strokeWidth={3} />}
      </span>
      <div>
        <p className="ready-step-title">
          {title}
          <span className="sr-only">{done ? ' (done)' : ' (to do)'}</span>
        </p>
        {!done && children}
      </div>
    </li>
  );
}

export function Wallet() {
  const [hidden, toggleHidden] = useHiddenBalances();
  const summary = useApiRead('points', pointsSummary);
  const purchases = useApiRead('purchases?limit=30', purchasePage);
  const withdrawals = useApiRead('wallet/withdrawals?limit=10', withdrawalPage);
  const bank = useApiRead(
    summary.data?.phoneVerified ? 'wallet/bank-account' : null,
    bankAccount,
  );
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
                  background: 'var(--color-ink-fill)',
                  color: 'var(--color-on-fill)',
                  borderColor: 'var(--color-ink-fill)',
                }}
              >
                <div className="row">
                  <p
                    className="eyebrow"
                    style={{
                      margin: 0,
                      color:
                        'color-mix(in srgb, var(--color-on-fill) 72%, transparent)',
                    }}
                  >
                    In your wallet
                  </p>
                  <button
                    type="button"
                    className="eye-toggle"
                    aria-pressed={hidden}
                    aria-label={hidden ? 'Show balances' : 'Hide balances'}
                    onClick={toggleHidden}
                  >
                    {hidden ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <p
                  className="amount amount-xl"
                  style={{ margin: '0.25rem 0 0.75rem' }}
                >
                  {hidden ? (
                    <span aria-label="Balance hidden">₦ ••••••</span>
                  ) : (
                    naira(data.walletKobo)
                  )}
                </p>
                {data.phoneVerified &&
                !bank.data?.locked &&
                BigInt(data.walletKobo) >= minWithdrawKobo &&
                usable(bank.data?.destination) ? (
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
                        'color-mix(in srgb, var(--color-on-fill) 72%, transparent)',
                    }}
                  >
                    {data.phoneVerified ? (
                      bank.data?.locked ? (
                        'Withdrawals are locked while support checks your account.'
                      ) : BigInt(data.walletKobo) < minWithdrawKobo ? (
                        'You can withdraw once you have ₦1,000 or more.'
                      ) : bank.data?.destination ? (
                        'Your new bank account can receive money 24 hours after you added it.'
                      ) : (
                        'Add a bank account below to withdraw.'
                      )
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
                <Link className="wallet-spend" href="/wallet/bills">
                  Buy airtime, data or pay bills{' '}
                  <ArrowRight size={15} aria-hidden />
                </Link>
              </div>
              <div className="card">
                <p className="eyebrow">Held cash back</p>
                <p
                  className="amount amount-xl amount-pending"
                  style={{ margin: '0.25rem 0 0.75rem' }}
                >
                  {hidden ? (
                    <span aria-label="Balance hidden">₦ ••••</span>
                  ) : (
                    naira(held.toString())
                  )}
                </p>
                <p className="small-note">
                  Held during each business&apos;s refund window. Not yet yours
                  to spend.
                </p>
              </div>
            </section>

            {!(data.phoneVerified && bank.data?.destination) && (
              <section className="card ready" aria-labelledby="ready-heading">
                <h2 id="ready-heading">Get ready to withdraw</h2>
                <p className="small-note">
                  Two quick checks keep your money going to you and nobody else.
                </p>
                <ol className="ready-steps">
                  <Step done={data.phoneVerified} title="Verify your phone">
                    <p className="small-note">
                      One number per person.{' '}
                      <Link href="/verify-phone?next=/wallet">
                        Verify your phone
                      </Link>
                    </p>
                  </Step>
                  <Step
                    done={Boolean(bank.data?.destination)}
                    title="Add a bank account in your name"
                  >
                    <p className="small-note">
                      {data.phoneVerified
                        ? 'Add it below. We check the name with your bank.'
                        : 'You can add it right after your phone is verified.'}
                    </p>
                  </Step>
                  <Step
                    done={BigInt(data.walletKobo) >= minWithdrawKobo}
                    title="Have ₦1,000 or more in your wallet"
                  />
                </ol>
              </section>
            )}

            {data.phoneVerified && bank.data && (
              <BankAccount
                account={bank.data.destination}
                onSaved={bank.refresh}
              />
            )}
            {bank.data?.destination && (
              <WithdrawalLock
                locked={bank.data.locked}
                onLocked={() => {
                  setWithdrawing(false);
                  setNotice('');
                  bank.refresh();
                  withdrawals.refresh();
                  summary.refresh();
                }}
              />
            )}
            {withdrawing && (
              <div id="withdraw-panel">
                <WithdrawPanel
                  walletKobo={data.walletKobo}
                  to={
                    bank.data?.destination
                      ? `${bank.data.destination.accountName}, ${bank.data.destination.bankName} ••••${bank.data.destination.last4}`
                      : ''
                  }
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
                              loading={busy === item.id}
                              onClick={() => void release(item.id)}
                            >
                              {busy === item.id ? 'Moving…' : 'Move to wallet'}
                            </Button>
                          ) : (
                            <span className={chip}>{text}</span>
                          )}
                        </div>
                        {item.state === 'voided' && (
                          <VoidDispute
                            item={item}
                            now={Date.parse(purchases.data!.observedAt)}
                            onDone={purchases.refresh}
                          />
                        )}
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

            <p className="small-note">
              Won a prize code? <Link href="/claim">Claim it here</Link>. Points
              and your tier are on your <Link href="/profile">profile</Link>.
            </p>
          </div>
        )
      )}
    </Page>
  );
}
