'use client';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { apiRequest, naira, newId, shortDate, toKobo } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { withdrawal } from '@/lib/rewards';

type Withdrawal = z.infer<typeof withdrawal>;
const minKobo = 50000n;
const maxKobo = 500000000n;

export const withdrawalState = {
  held: ['Processing', 'chip chip-pending'],
  sent: ['Sent', 'chip chip-ready'],
  paid: ['Paid', 'chip chip-done'],
  failed: ['Returned to wallet', 'chip chip-muted'],
} as const;

function withdrawError(error: unknown) {
  if (error instanceof RequestError) {
    switch (error.code) {
      case 'payments_unavailable':
        return 'Withdrawals open when payouts go live. Your balance is safe and recorded.';
      case 'insufficient_balance':
        return 'That is more than your wallet balance.';
      case 'withdrawal_daily_limit':
        return 'You can make three withdrawals a day. Try again tomorrow.';
      case 'destination_required':
        return 'Add a bank account first.';
      case 'destination_cooling':
        return 'Your new bank account can receive money 24 hours after you added it.';
      case 'withdrawal_unavailable':
        return 'Withdrawals need an active account with a verified phone number. Verify it from your wallet.';
    }
    if (error.status === 400)
      return 'Enter an amount between ₦500 and ₦5,000,000.';
  }
  return 'We could not confirm the withdrawal. Check your connection and try again; it will never be taken twice.';
}

export function WithdrawPanel({
  walletKobo,
  to,
  onDone,
  onCancel,
}: {
  walletKobo: string;
  to: string;
  onDone: (result: Withdrawal) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState('');
  // A lost response keeps the same ID, so trying again never withdraws twice.
  const attempt = useRef<{ id: string; amountKobo: string } | null>(null);
  const kobo = toKobo(amount);
  const all = BigInt(walletKobo) > maxKobo ? maxKobo : BigInt(walletKobo);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!kobo || BigInt(kobo) < minKobo || BigInt(kobo) > maxKobo) {
      setInvalid('Enter an amount between ₦500 and ₦5,000,000.');
      return;
    }
    if (BigInt(kobo) > BigInt(walletKobo)) {
      setInvalid(`You have ${naira(walletKobo)} in your wallet.`);
      return;
    }
    setInvalid('');
    if (attempt.current?.amountKobo !== kobo)
      attempt.current = { id: newId(), amountKobo: kobo };
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest('wallet/withdrawals', withdrawal, {
        method: 'POST',
        body: attempt.current,
      });
      attempt.current = null;
      onDone(result);
    } catch (cause) {
      if (cause instanceof RequestError && cause.status < 500)
        attempt.current = null;
      setError(withdrawError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card grid gap-4" aria-labelledby="withdraw-heading">
      <div className="card-head">
        <h2 id="withdraw-heading">Withdraw</h2>
        {to && <p style={{ color: 'var(--color-ink)' }}>To {to}</p>}
        <p>
          The amount leaves your wallet at once and is held until the payment
          provider confirms it. If a payout fails, it comes straight back.
        </p>
      </div>
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <Field
          id="withdraw-amount"
          label="Amount in naira"
          inputMode="decimal"
          autoComplete="off"
          placeholder="5,000"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setInvalid('');
          }}
          hint={`Minimum ₦500. Up to three withdrawals a day.`}
          error={invalid}
        />
        {all >= minKobo && (
          <button
            type="button"
            className="text-link"
            style={{ justifySelf: 'start' }}
            onClick={() => {
              setAmount(naira(all.toString()).replace('₦', ''));
              setInvalid('');
            }}
          >
            Withdraw everything ({naira(all.toString())})
          </button>
        )}
        {error && <Feedback error>{error}</Feedback>}
        <div className="row" style={{ justifyContent: 'flex-start' }}>
          <Button variant="accent" type="submit" disabled={busy}>
            {busy
              ? 'Withdrawing…'
              : kobo
                ? `Withdraw ${naira(kobo)}`
                : 'Withdraw'}
          </Button>
          <Button variant="ghost" type="button" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}

export function WithdrawalList({ items }: { items: Withdrawal[] }) {
  return (
    <section aria-labelledby="withdrawals-heading">
      <h2 id="withdrawals-heading">Withdrawals</h2>
      <ul className="stack">
        {items.map((item) => {
          const [text, chip] = withdrawalState[item.state];
          return (
            <li key={item.id} className="card row" style={{ flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: '1 1 10rem' }}>
                <p className="amount" style={{ margin: 0 }}>
                  {naira(item.amountKobo)}
                </p>
                <p className="small-note">
                  {shortDate(item.createdAt)}
                  {item.bank ? ` · ${item.bank}` : ''}
                </p>
              </div>
              <span className={chip}>{text}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
