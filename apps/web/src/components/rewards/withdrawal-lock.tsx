'use client';
import { useState } from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { apiRequest } from '@/lib/api';

// "This wasn't me": anyone who sees a bank account or withdrawal they did not
// make can stop all withdrawals at once. Only support can open them again.
export function WithdrawalLock({
  locked,
  onLocked,
}: {
  locked: boolean;
  onLocked: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function lock() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest('wallet/lock', z.object({ locked: z.literal(true) }), {
        method: 'POST',
        body: {},
      });
      setConfirming(false);
      onLocked();
    } catch {
      setError(
        'We could not lock withdrawals. Try again, or change your password now.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (locked)
    return (
      <section
        className="card"
        role="status"
        aria-label="Withdrawals locked"
        style={{
          borderColor: 'var(--color-danger)',
          background: 'var(--color-danger-surface)',
        }}
      >
        <p className="icon-line" style={{ margin: 0, fontWeight: 600 }}>
          <ShieldAlert
            size={20}
            aria-hidden
            style={{ color: 'var(--color-danger)' }}
          />
          Withdrawals are locked
        </p>
        <p className="small-note">
          Your balance is safe. Acticlaim support will check your account and
          contact you before withdrawals open again. Change your password now if
          you have not already.
        </p>
      </section>
    );

  return (
    <section className="card grid gap-3" aria-labelledby="lock-heading">
      <div className="icon-line">
        <ShieldCheck
          size={20}
          aria-hidden
          style={{ color: 'var(--color-brand-text)' }}
        />
        <h2 id="lock-heading" style={{ margin: 0, fontSize: '1rem' }}>
          See a bank account or withdrawal you did not make?
        </h2>
      </div>
      <p className="small-note" style={{ margin: 0 }}>
        Lock withdrawals at once. Withdrawals not yet sent to the bank are
        stopped and the money stays in your wallet.
      </p>
      {error && <Feedback error>{error}</Feedback>}
      {confirming ? (
        <div className="row" style={{ justifyContent: 'flex-start' }}>
          <Button
            type="button"
            variant="danger"
            loading={busy}
            onClick={() => void lock()}
          >
            {busy ? 'Locking…' : 'Yes, lock withdrawals'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            loading={busy}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          style={{ justifySelf: 'start' }}
          onClick={() => setConfirming(true)}
        >
          This wasn&apos;t me
        </Button>
      )}
    </section>
  );
}
