'use client';
import { useRef, useState } from 'react';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Feedback } from '@/components/ui/feedback';
import { apiRequest, naira, newId } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { campaignReturn } from '@/lib/rewards';
import type { businessCampaign } from '@/lib/rewards';

type Campaign = z.infer<typeof businessCampaign>;
const ended = (endsAt: string) => Date.parse(endsAt) <= Date.now();

// Which campaigns can give money back, and how.
type Returnable = { campaign: Campaign; kind: 'cancel' | 'return' };
export function returnable(items: Campaign[]): Returnable[] {
  return items.flatMap((c): Returnable[] => {
    if (!c.balanceKobo || BigInt(c.balanceKobo) <= 0n || c.cancelled) return [];
    if (!c.published) return [{ campaign: c, kind: 'cancel' }];
    if (
      ended(c.endsAt) &&
      (c.model === 'purchase_cashback' || c.model === 'claim_code')
    )
      return [{ campaign: c, kind: 'return' }];
    return [];
  });
}

function returnError(error: unknown) {
  if (error instanceof RequestError) {
    if (error.code === 'nothing_to_return')
      return 'Nothing to return yet: the rest is owed to shoppers who have not moved their cash back.';
    if (error.code === 'funds_in_use')
      return 'This campaign is still running, so its money stays locked.';
  }
  return 'We could not return the money. Check your connection and try again; it will never be returned twice.';
}

export function FundsBack({
  items,
  onDone,
}: {
  items: Campaign[];
  onDone: () => void;
}) {
  const rows = returnable(items);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // One request ID per campaign until it succeeds, so retries are safe.
  const ids = useRef(new Map<string, string>());

  async function give(taskId: string) {
    if (busy) return;
    const id = ids.current.get(taskId) ?? newId();
    ids.current.set(taskId, id);
    setBusy(taskId);
    setError('');
    setNotice('');
    try {
      const result = await apiRequest(
        `campaigns/${taskId}/returns`,
        campaignReturn,
        { method: 'POST', body: { id } },
      );
      ids.current.delete(taskId);
      setConfirming(null);
      setNotice(
        `${naira(result.amountKobo)} is back in your available balance.`,
      );
      onDone();
    } catch (cause) {
      if (cause instanceof RequestError && cause.status < 500)
        ids.current.delete(taskId);
      setError(returnError(cause));
    } finally {
      setBusy(null);
    }
  }

  if (!rows.length && !notice) return null;
  return (
    <section className="card" aria-labelledby="back-heading">
      <div className="card-head">
        <h2 id="back-heading">Money you can take back</h2>
        <p>
          Unused money returns to your available balance. Anything owed to
          shoppers stays locked until they are paid.
        </p>
      </div>
      {notice && <Feedback>{notice}</Feedback>}
      {error && !confirming && <Feedback error>{error}</Feedback>}
      <ul className="stack">
        {rows.map(({ campaign: c, kind }) => (
          <li key={c.id} className="grid gap-2">
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: '1 1 12rem' }}>
                <p style={{ margin: 0, fontWeight: 600 }}>{c.title}</p>
                <p className="small-note">
                  {kind === 'cancel'
                    ? `Not live yet · ${naira(c.balanceKobo!)} locked`
                    : `Ended · up to ${naira(c.balanceKobo!)} unused`}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                loading={busy === c.id}
                onClick={() => {
                  setError('');
                  if (kind === 'cancel') setConfirming(c.id);
                  else void give(c.id);
                }}
              >
                {busy === c.id
                  ? 'Returning…'
                  : kind === 'cancel'
                    ? 'Cancel and return'
                    : 'Return unused money'}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {(() => {
        const c = rows.find((r) => r.campaign.id === confirming)?.campaign;
        return (
          <ConfirmDialog
            open={Boolean(c)}
            onClose={() => setConfirming(null)}
            onConfirm={() => c && void give(c.id)}
            danger
            busy={busy !== null}
            title={`Cancel “${c?.title ?? ''}”?`}
            description={`It can never go live afterwards, and ${c ? naira(c.balanceKobo!) : ''} returns to your available balance.`}
            confirmLabel="Cancel campaign"
            busyLabel="Cancelling…"
            cancelLabel="Keep it"
          >
            {error && <Feedback error>{error}</Feedback>}
          </ConfirmDialog>
        );
      })()}
    </section>
  );
}
