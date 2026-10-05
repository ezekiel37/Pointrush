'use client';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Landmark } from 'lucide-react';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { apiRequest, shortDate } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { bankAccount, bankList } from '@/lib/rewards';
import { useApiRead } from '@/lib/use-api-read';

type Account = NonNullable<z.infer<typeof bankAccount>['destination']>;

function addError(error: unknown) {
  if (error instanceof RequestError) {
    switch (error.code) {
      case 'account_not_found':
        return 'The bank could not find this account. Check the bank and the 10-digit number.';
      case 'destination_limit':
        return 'You have changed your bank account too often. Try again later or contact support.';
      case 'bank_unavailable':
        return 'The bank could not be reached. Try again in a few minutes.';
      case 'payments_unavailable':
        return 'Withdrawals open when payouts go live.';
    }
    if (error.status === 400)
      return 'Choose your bank and enter the 10-digit account number.';
  }
  return 'We could not check this account. Check your connection and try again.';
}

export function usable(account: Account | null | undefined) {
  return Boolean(account && Date.parse(account.usableFrom) <= Date.now());
}

// Where withdrawals go. The bank's own account name is shown for the person
// to confirm; only the last four digits are kept.
export function BankAccount({
  account,
  onSaved,
}: {
  account: Account | null;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const banks = useApiRead(
    editing || !account ? 'wallet/banks' : null,
    bankList,
  );
  const [bankCode, setBankCode] = useState('');
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!bankCode || !/^\d{10}$/.test(number)) {
      setError('Choose your bank and enter the 10-digit account number.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await apiRequest('wallet/bank-account', bankAccount, {
        method: 'POST',
        body: { bankCode, accountNumber: number },
      });
      setEditing(false);
      setNumber('');
      onSaved();
    } catch (cause) {
      setError(addError(cause));
    } finally {
      setBusy(false);
    }
  }

  if (account && !editing)
    return (
      <section
        className="card row"
        style={{ flexWrap: 'wrap' }}
        aria-label="Bank account"
      >
        <div className="icon-line" style={{ minWidth: 0, flex: '1 1 14rem' }}>
          <Landmark
            size={20}
            aria-hidden
            style={{ color: 'var(--color-brand-text)' }}
          />
          <div style={{ minWidth: 0 }}>
            <p className="truncate" style={{ margin: 0, fontWeight: 600 }}>
              {account.accountName}
            </p>
            <p className="small-note truncate">
              {account.bankName} ••••{account.last4}
              {!usable(account) &&
                ` · usable from ${shortDate(account.usableFrom)}`}
            </p>
          </div>
        </div>
        <Button type="button" variant="ghost" onClick={() => setEditing(true)}>
          Change
        </Button>
      </section>
    );

  return (
    <form
      className="card grid gap-4"
      onSubmit={save}
      noValidate
      aria-labelledby="bank-heading"
    >
      <div className="card-head">
        <h2 id="bank-heading">
          {account ? 'Change bank account' : 'Add a bank account'}
        </h2>
        <p>
          Withdrawals go here. We check the account with the bank and show you
          the name it holds.
          {account &&
            ' For your safety, a new account can receive money after 24 hours.'}
        </p>
      </div>
      <div className="field">
        <label htmlFor="bank-code">Bank</label>
        <select
          id="bank-code"
          className="input"
          value={bankCode}
          onChange={(e) => {
            setBankCode(e.target.value);
            setError('');
          }}
          disabled={!banks.data}
        >
          <option value="">
            {banks.data ? 'Choose your bank' : 'Loading banks…'}
          </option>
          {banks.data?.items.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <Field
        id="account-number"
        label="Account number"
        inputMode="numeric"
        autoComplete="off"
        maxLength={10}
        placeholder="0123456789"
        value={number}
        onChange={(e) => {
          setNumber(e.target.value.replace(/\D/g, ''));
          setError('');
        }}
      />
      {error && <Feedback error>{error}</Feedback>}
      <div className="row" style={{ justifyContent: 'flex-start' }}>
        <Button variant="accent" type="submit" disabled={busy}>
          {busy ? 'Checking with the bank…' : 'Check and save'}
        </Button>
        {account && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
