'use client';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowUpRight,
  Check,
  Clock3,
  Eye,
  EyeOff,
  Smartphone,
  Store,
  TicketCheck,
  Tv,
  Wallet as WalletIcon,
  Wifi,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
import { WithdrawalList, WithdrawPanel } from './withdraw';
import { nairaOfKobo, useLimits } from '@/lib/limits';
import { WithdrawalLock } from './withdrawal-lock';
import { VoidDispute } from './void-dispute';

const stateLabel = {
  pending: ['Held', 'chip chip-pending'],
  releasable: ['Ready', 'chip chip-ready'],
  released: ['In wallet', 'chip chip-done'],
  voided: ['Withdrawn by business', 'chip chip-muted'],
} as const;

// Everyday ways to use the balance, one tap from the wallet.
const quickActions: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/wallet/bills?kind=airtime', label: 'Airtime', icon: Smartphone },
  { href: '/wallet/bills?kind=data', label: 'Data', icon: Wifi },
  { href: '/wallet/bills?kind=electricity', label: 'Electricity', icon: Zap },
  { href: '/wallet/bills?kind=tv', label: 'TV', icon: Tv },
  { href: '/claim', label: 'Claim', icon: TicketCheck },
];

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
    .reduce((sum, p) => sum + BigInt(p.payoutKobo ?? p.cashbackKobo), 0n);
  const data = summary.data;
  const { limits } = useLimits();
  const minWithdrawKobo = BigInt(limits.withdrawals.minKobo);
  const canWithdraw = Boolean(
    data?.phoneVerified &&
    !bank.data?.locked &&
    BigInt(data.walletKobo) >= minWithdrawKobo &&
    usable(bank.data?.destination),
  );
  const withdrawBlock = !data?.phoneVerified
    ? 'Withdrawing needs a verified phone number.'
    : bank.data?.locked
      ? 'Withdrawals are locked while support checks your account.'
      : BigInt(data.walletKobo) < minWithdrawKobo
        ? `You can withdraw once you have ${nairaOfKobo(limits.withdrawals.minKobo)} or more.`
        : bank.data?.destination
          ? 'Your new bank account can receive money 24 hours after you added it.'
          : 'Add a bank account below to withdraw.';
  return (
    <Page title="Wallet">
      {summary.loading && !data ? (
        <Loading>Loading your wallet…</Loading>
      ) : summary.error && !data ? (
        <WorkFailure error={summary.error} retry={summary.refresh} />
      ) : (
        data && (
          <div className="grid gap-6">
            <section className="wallet-card" aria-labelledby="balance-heading">
              <div className="row">
                <p id="balance-heading" className="wallet-card-label">
                  <span className="wallet-card-icon" aria-hidden>
                    <WalletIcon size={18} />
                  </span>
                  Wallet balance
                </p>
                <button
                  type="button"
                  className="eye-toggle"
                  aria-pressed={hidden}
                  aria-label={hidden ? 'Show balances' : 'Hide balances'}
                  onClick={toggleHidden}
                >
                  {hidden ? (
                    <EyeOff size={18} aria-hidden />
                  ) : (
                    <Eye size={18} aria-hidden />
                  )}
                  <span>{hidden ? 'Show' : 'Hide'}</span>
                </button>
              </div>
              <p className="amount wallet-card-amount">
                {hidden ? (
                  <span aria-label="Balance hidden">₦ ••••••</span>
                ) : (
                  naira(data.walletKobo)
                )}
              </p>
              <p className="wallet-card-held">
                <Clock3 size={15} aria-hidden />
                {hidden ? '₦ ••••' : naira(held.toString())} cash back on hold
              </p>
              {!canWithdraw && (
                <p className="wallet-card-note">
                  {withdrawBlock}
                  {!data.phoneVerified && (
                    <>
                      {' '}
                      <Link href="/verify-phone?next=/wallet">
                        Verify your phone
                      </Link>
                    </>
                  )}
                </p>
              )}
            </section>

            <nav className="quick-actions" aria-label="Wallet actions">
              <button
                type="button"
                className="quick-action"
                aria-expanded={withdrawing}
                aria-controls="withdraw-panel"
                aria-disabled={!canWithdraw}
                onClick={() => {
                  if (!canWithdraw) {
                    setNotice(withdrawBlock);
                    return;
                  }
                  setWithdrawing(true);
                  setNotice('');
                }}
              >
                <span className="quick-action-icon" aria-hidden>
                  <ArrowUpRight size={22} />
                </span>
                Withdraw
              </button>
              {quickActions.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} className="quick-action">
                  <span className="quick-action-icon" aria-hidden>
                    <Icon size={22} />
                  </span>
                  {label}
                </Link>
              ))}
            </nav>

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
                    title={`Have ${nairaOfKobo(limits.withdrawals.minKobo)} or more in your wallet`}
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
              <h2 id="purchases-heading">Cash back history</h2>
              {purchases.loading && !purchases.data ? (
                <Loading>Loading cash back…</Loading>
              ) : purchases.data?.items.length ? (
                <ul className="tx-list">
                  {purchases.data.items.map((item) => {
                    const [text, chip] = stateLabel[item.state];
                    return (
                      <li key={item.id}>
                        <div className="tx-row">
                          <span
                            className={`tx-icon tx-icon-${item.state}`}
                            aria-hidden
                          >
                            <Store size={18} />
                          </span>
                          <div className="tx-main">
                            <p className="tx-title truncate">
                              {item.businessName}
                            </p>
                            <p className="small-note truncate">
                              {item.state === 'pending' &&
                              item.group &&
                              !item.payoutKobo
                                ? `Group offer: ${naira(item.cashbackKobo)} if ${item.group.target} people buy, ${naira(item.group.baseKobo)} if not`
                                : item.state === 'pending'
                                  ? `Unlocks ${shortDate(item.releaseAt)}`
                                  : `Bought ${shortDate(item.createdAt)}`}
                            </p>
                          </div>
                          <div className="tx-end">
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
                              {hidden
                                ? '₦ ••••'
                                : item.payoutKobo || !item.group
                                  ? `+${naira(item.payoutKobo ?? item.cashbackKobo)}`
                                  : `Up to ${naira(item.cashbackKobo)}`}
                            </span>
                            {item.state !== 'releasable' && (
                              <span className={chip}>{text}</span>
                            )}
                          </div>
                        </div>
                        {item.state === 'releasable' && (
                          <Button
                            variant="accent"
                            type="button"
                            className="tx-action"
                            disabled={busy !== null}
                            loading={busy === item.id}
                            onClick={() => void release(item.id)}
                          >
                            {busy === item.id ? 'Moving…' : 'Move to wallet'}
                          </Button>
                        )}
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
              Points and your tier are on your{' '}
              <Link href="/profile">profile</Link>.
            </p>
          </div>
        )
      )}
    </Page>
  );
}
