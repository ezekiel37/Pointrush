'use client';
import { useState } from 'react';
import { z } from 'zod';
import { ReviewFrame } from './review-frame';
import { denied } from '@/components/admin/admin-frame';
import { Button } from '@/components/ui/button';
import { Feedback, Loading } from '@/components/ui/feedback';
import { WorkFailure } from '@/components/work/work-frame';
import { ReviewAccess } from '@/components/work/review-access';
import { apiRequest, money, naira, shortDate } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { useApiRead } from '@/lib/use-api-read';

const pending = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      amountKobo: money,
      createdAt: z.string(),
      accountId: z.uuid(),
      accountCreatedAt: z.string(),
      username: z.string().nullable(),
      displayName: z.string().nullable(),
      email: z.string().nullable(),
      phoneVerified: z.boolean(),
      bank: z.string().nullable(),
      purchases: z.number(),
      prizes: z.number(),
      withdrawals: z.number(),
    }),
  ),
});

function decideError(error: unknown) {
  if (error instanceof RequestError) {
    if (error.code === 'withdrawal_approval_unavailable')
      return 'This withdrawal cannot be decided by you: it may be your own, or it was already sent or returned.';
    if (error.status === 400) return 'Give a reason of at least 3 characters.';
  }
  return 'We could not record the decision. Try again; it is recorded once.';
}

// Withdrawals that wait for a reviewer: approval is on, or phone
// verification is off. Approving lets the payout go; rejecting returns the
// money to the person's wallet with the reason.
export function WithdrawalApprovals() {
  const read = useApiRead('admin/withdrawals/pending', pending);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function decide(id: string, decision: 'approved' | 'rejected') {
    const reason = (reasons[id] ?? '').trim();
    if (reason.length < 3) {
      setError(
        decision === 'approved'
          ? 'Say why you approve it, for example "known pilot customer".'
          : 'Say why it is not approved. The person sees this reason.',
      );
      return;
    }
    setBusy(`${id}:${decision}`);
    setError('');
    try {
      await apiRequest(`admin/withdrawals/${id}/decisions`, z.unknown(), {
        method: 'POST',
        body: { decision, reason },
      });
      read.refresh();
    } catch (cause) {
      setError(decideError(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ReviewFrame
      title="Withdrawals to approve"
      intro="Each withdrawal here is held until a reviewer decides. Check the person and their activity. Approving sends the money; not approving returns it to their wallet with your reason."
    >
      <div className="grid gap-4" style={{ maxWidth: 720, marginTop: '1rem' }}>
        {error && <Feedback error>{error}</Feedback>}
        {read.loading && !read.data ? (
          <Loading>Loading withdrawals…</Loading>
        ) : read.error && denied(read.error) ? (
          <ReviewAccess />
        ) : read.error ? (
          <WorkFailure error={read.error} retry={read.refresh} />
        ) : read.data?.items.length ? (
          <ul className="stack">
            {read.data.items.map((w) => (
              <li key={w.id} className="card grid gap-3">
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 600 }}>
                      {w.displayName ?? 'No name'}
                      {w.username ? ` · @${w.username}` : ''}
                    </p>
                    <p className="small-note">
                      {w.email ?? 'No email'} · joined{' '}
                      {shortDate(w.accountCreatedAt)} ·{' '}
                      {w.phoneVerified ? 'phone verified' : 'no verified phone'}
                    </p>
                  </div>
                  <span className="amount">{naira(w.amountKobo)}</span>
                </div>
                <p className="small-note" style={{ margin: 0 }}>
                  To {w.bank ?? 'no bank account'} · asked{' '}
                  {shortDate(w.createdAt)} · {w.purchases} purchases, {w.prizes}{' '}
                  prizes, {w.withdrawals} withdrawals so far
                </p>
                <label className="field-label" htmlFor={`reason-${w.id}`}>
                  Reason
                </label>
                <textarea
                  id={`reason-${w.id}`}
                  className="input textarea"
                  rows={2}
                  maxLength={300}
                  value={reasons[w.id] ?? ''}
                  onChange={(ev) =>
                    setReasons((r) => ({ ...r, [w.id]: ev.target.value }))
                  }
                />
                <div className="row" style={{ justifyContent: 'flex-start' }}>
                  <Button
                    type="button"
                    variant="accent"
                    disabled={busy !== null}
                    loading={busy === `${w.id}:approved`}
                    onClick={() => void decide(w.id, 'approved')}
                  >
                    Approve and send
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy !== null}
                    loading={busy === `${w.id}:rejected`}
                    onClick={() => void decide(w.id, 'rejected')}
                  >
                    Do not approve
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small-note">No withdrawals are waiting.</p>
        )}
      </div>
    </ReviewFrame>
  );
}
