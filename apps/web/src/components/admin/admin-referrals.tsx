'use client';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Feedback, Loading } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { toast } from '@/components/ui/toast';
import { apiRequest, naira, newId, shortDate, toKobo } from '@/lib/api';
import { referralPool } from '@/lib/admin';
import { useApiRead } from '@/lib/use-api-read';
import { AdminFailure, AdminFrame } from './admin-frame';

// Acticlaim's referral money: what went in, what was paid, what is left.
export function AdminReferrals() {
  const read = useApiRead('admin/referrals', referralPool);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [bankReference, setBankReference] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // A lost response keeps the same ID, so the deposit is recorded once.
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const data = read.data;
  const kobo = toKobo(amount);
  const ready =
    kobo !== null &&
    BigInt(kobo) > 0n &&
    bankReference.trim().length >= 3 &&
    reason.trim().length >= 3;

  async function fund(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    const key = `${kobo}:${bankReference.trim()}`;
    if (attempt.current?.key !== key) attempt.current = { key, id: newId() };
    setBusy(true);
    setError('');
    try {
      await apiRequest('admin/referrals/topups', z.object({ id: z.uuid() }), {
        method: 'POST',
        body: {
          id: attempt.current.id,
          amountKobo: kobo,
          bankReference: bankReference.trim(),
          reason: reason.trim(),
        },
      });
      attempt.current = null;
      toast(`${naira(kobo!)} added to the referral pool`);
      setOpen(false);
      setAmount('');
      setBankReference('');
      setReason('');
      read.refresh();
    } catch {
      setError('We could not record it. Try again; it is recorded only once.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminFrame
      title="Referrals"
      intro="Referral rewards are paid from this pool, which holds Acticlaim's own money. When it runs out, rewards wait until it is topped up."
      actions={
        data?.canFund && (
          <Button variant="accent" type="button" onClick={() => setOpen(true)}>
            <Plus size={17} aria-hidden /> Add money
          </Button>
        )
      }
    >
      {read.loading && !data ? (
        <Loading>Loading the pool…</Loading>
      ) : read.error && !data ? (
        <AdminFailure error={read.error} retry={read.refresh} />
      ) : (
        data && (
          <div className="grid gap-5" style={{ maxWidth: 860 }}>
            <dl className="stat-row" style={{ margin: 0 }}>
              <div className="stat">
                <dt>Left in the pool</dt>
                <dd className="num">{naira(data.balanceKobo)}</dd>
              </div>
              <div className="stat">
                <dt>Paid this month</dt>
                <dd className="num">{naira(data.paidThisMonthKobo)}</dd>
              </div>
              <div className="stat">
                <dt>Paid in total</dt>
                <dd className="num">{naira(data.paidKobo)}</dd>
              </div>
              <div className="stat">
                <dt>Invites / rewards</dt>
                <dd className="num">
                  {data.invites} / {data.rewards}
                </dd>
              </div>
            </dl>
            {BigInt(data.balanceKobo) === 0n && (
              <Feedback error>
                The pool is empty, so no referral rewards are being paid.
              </Feedback>
            )}
            <section className="card">
              <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Recent rewards</h2>
              {data.recent.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Inviter</th>
                        <th scope="col">Invited</th>
                        <th scope="col">Kind</th>
                        <th scope="col">Measured on</th>
                        <th scope="col">Paid</th>
                        <th scope="col">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent.map((r) => (
                        <tr key={r.id}>
                          <td>{r.inviter ? `@${r.inviter}` : '—'}</td>
                          <td>{r.invited ? `@${r.invited}` : '—'}</td>
                          <td>
                            {r.kind === 'business' ? 'Business' : 'Friend'}
                          </td>
                          <td>{naira(r.basisKobo)}</td>
                          <td>{naira(r.amountKobo)}</td>
                          <td>{shortDate(r.at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="small-note">No rewards paid yet.</p>
              )}
            </section>
            <section className="card">
              <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Money added</h2>
              {data.topups.length ? (
                <ul className="stack">
                  {data.topups.map((t) => (
                    <li key={t.id}>
                      <strong>{naira(t.amountKobo)}</strong> · {t.reason}
                      <span className="small-note">
                        {' '}
                        Ref {t.bankReference} · {t.by ? `@${t.by}` : '—'} ·{' '}
                        {shortDate(t.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="small-note">Nothing added yet.</p>
              )}
            </section>
            <Dialog
              open={open}
              onClose={() => !busy && setOpen(false)}
              title="Add money to the referral pool"
              description="Record a deposit already in Acticlaim's bank account. Rewards can never exceed what is recorded here."
            >
              <form className="grid gap-4" onSubmit={fund} noValidate>
                <Field
                  id="pool-amount"
                  label="Amount (₦)"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  disabled={busy}
                  data-autofocus
                />
                <Field
                  id="pool-reference"
                  label="Bank reference"
                  hint="From the transfer into Acticlaim's account"
                  value={bankReference}
                  onChange={(event) => setBankReference(event.target.value)}
                  disabled={busy}
                />
                <Field
                  id="pool-reason"
                  label="Reason"
                  placeholder="October referral budget"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  disabled={busy}
                />
                {error && <Feedback error>{error}</Feedback>}
                <div className="dialog-foot">
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="accent"
                    type="submit"
                    disabled={!ready}
                    loading={busy}
                  >
                    Add {kobo ? naira(kobo) : 'money'}
                  </Button>
                </div>
              </form>
            </Dialog>
          </div>
        )
      )}
    </AdminFrame>
  );
}
