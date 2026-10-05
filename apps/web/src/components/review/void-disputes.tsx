'use client';
import { useState } from 'react';
import { z } from 'zod';
import { ReviewFrame } from './review-frame';
import { Button } from '@/components/ui/button';
import { Feedback, Loading } from '@/components/ui/feedback';
import { WorkFailure } from '@/components/work/work-frame';
import { ReviewAccess } from '@/components/work/review-access';
import { apiRequest, money, naira, shortDate } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { useApiRead } from '@/lib/use-api-read';

const date = z.iso.datetime({ offset: true });
const disputes = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      business: z.string(),
      shopper: z.string().nullable(),
      amountKobo: money,
      cashbackKobo: money,
      purchasedAt: date,
      voidReason: z.string(),
      voidedAt: date,
      note: z.string(),
      disputedAt: date,
      campaignConfirmed: z.number().int(),
      campaignVoided: z.number().int(),
    }),
  ),
});
type Decision = 'upheld' | 'reversed';

function denied(error: unknown) {
  return (
    error instanceof RequestError &&
    (error.status === 401 || error.status === 403)
  );
}

// Shoppers who say a business voided a real purchase. Reversing pays the
// shopper from the campaign's locked money; upholding lets it go back to the
// business. Either decision is final and recorded.
export function VoidDisputes() {
  const read = useApiRead('admin/disputes', disputes);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  async function rule(id: string, decision: Decision) {
    const reason = (reasons[id] ?? '').trim();
    if (busy) return;
    if (reason.length < 3) {
      setError('Write the reason for your decision. Both sides see it.');
      return;
    }
    setBusy(id);
    setError('');
    try {
      await apiRequest(`admin/disputes/${id}/rulings`, z.unknown(), {
        method: 'POST',
        body: { decision, reason },
      });
      setDone(
        decision === 'reversed'
          ? 'Decision recorded. The shopper has been paid.'
          : 'Decision recorded. The void stands.',
      );
      read.refresh();
    } catch (cause) {
      setError(
        denied(cause)
          ? 'Your review access or authenticator check has expired. Verify again, then decide.'
          : 'We could not record the decision. Try again; it is recorded once.',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <ReviewFrame
      title="Void disputes"
      intro="Shoppers who say a business voided a real purchase. Check the reason against the dispute, then decide."
    >
      <div className="grid gap-4" style={{ maxWidth: 720, marginTop: '1rem' }}>
        {done && <Feedback>{done}</Feedback>}
        {error && <Feedback error>{error}</Feedback>}
        {read.loading && !read.data ? (
          <Loading>Loading disputes…</Loading>
        ) : read.error && denied(read.error) ? (
          <ReviewAccess />
        ) : read.error ? (
          <WorkFailure error={read.error} retry={read.refresh} />
        ) : read.data?.items.length ? (
          <ul className="stack">
            {read.data.items.map((item) => {
              const rate = Math.round(
                (100 * item.campaignVoided) /
                  Math.max(1, item.campaignConfirmed),
              );
              return (
                <li key={item.id} className="card grid gap-3">
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0, flex: '1 1 14rem' }}>
                      <h2 style={{ margin: 0, fontSize: '1.05rem' }}>
                        {item.business} · {item.title}
                      </h2>
                      <p className="small-note">
                        {item.shopper ? `@${item.shopper}` : 'Shopper'} spent{' '}
                        {naira(item.amountKobo)} on{' '}
                        {shortDate(item.purchasedAt)}
                      </p>
                    </div>
                    <span className="amount">{naira(item.cashbackKobo)}</span>
                  </div>
                  <dl className="terms-list">
                    <div>
                      <dt>Business said ({shortDate(item.voidedAt)})</dt>
                      <dd>{item.voidReason}</dd>
                    </div>
                    <div>
                      <dt>Shopper said ({shortDate(item.disputedAt)})</dt>
                      <dd>{item.note}</dd>
                    </div>
                    <div>
                      <dt>Voids on this campaign</dt>
                      <dd>
                        {item.campaignVoided} of {item.campaignConfirmed}{' '}
                        purchases ({rate}%)
                      </dd>
                    </div>
                  </dl>
                  <div className="field">
                    <label htmlFor={`ruling-${item.id}`}>Reason</label>
                    <textarea
                      id={`ruling-${item.id}`}
                      className="input textarea"
                      rows={2}
                      maxLength={500}
                      value={reasons[item.id] ?? ''}
                      onChange={(e) =>
                        setReasons((r) => ({ ...r, [item.id]: e.target.value }))
                      }
                    />
                  </div>
                  <div className="row" style={{ justifyContent: 'flex-start' }}>
                    <Button
                      type="button"
                      variant="accent"
                      disabled={busy !== null}
                      onClick={() => void rule(item.id, 'reversed')}
                    >
                      Pay the shopper
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => void rule(item.id, 'upheld')}
                    >
                      Keep the void
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="small-note">No disputes waiting.</p>
        )}
      </div>
    </ReviewFrame>
  );
}
