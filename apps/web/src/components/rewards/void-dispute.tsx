'use client';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Scale } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { apiRequest, shortDate } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import type { purchase } from '@/lib/rewards';

type Purchase = z.infer<typeof purchase>;

// Under a voided purchase: the business's reason and, for 7 days, a way to
// say it was a real purchase. A reviewer decides; the money stays locked.
export function VoidDispute({
  item,
  now,
  onDone,
}: {
  item: Purchase;
  now: number;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canDispute =
    !item.dispute &&
    item.disputeUntil !== null &&
    Date.parse(item.disputeUntil) > now;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!note.trim()) {
      setError('Say what you bought and when, and any receipt number.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await apiRequest(`purchases/${item.id}/disputes`, z.unknown(), {
        method: 'POST',
        body: { note: note.trim() },
      });
      setOpen(false);
      onDone();
    } catch (cause) {
      setError(
        cause instanceof RequestError && cause.code === 'dispute_unavailable'
          ? 'This void can no longer be disputed: the 7 days have passed.'
          : 'We could not send your dispute. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2" style={{ flexBasis: '100%' }}>
      {item.voidReason && (
        <p className="small-note" style={{ margin: 0 }}>
          Business&apos;s reason: {item.voidReason}
        </p>
      )}
      {item.dispute === 'open' && (
        <p className="icon-line small-note" style={{ margin: 0 }}>
          <Scale size={16} aria-hidden /> A reviewer is checking your dispute.
          The cash back stays locked until they decide.
        </p>
      )}
      {item.dispute === 'upheld' && (
        <p className="small-note" style={{ margin: 0 }}>
          A reviewer checked your dispute and the void stands.
        </p>
      )}
      {canDispute && !open && (
        <Button
          type="button"
          variant="outline"
          style={{ justifySelf: 'start' }}
          onClick={() => setOpen(true)}
        >
          This was a real purchase
        </Button>
      )}
      {canDispute && open && (
        <form className="grid gap-3" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor={`dispute-${item.id}`}>
              What did you buy? (until {shortDate(item.disputeUntil!)})
            </label>
            <textarea
              id={`dispute-${item.id}`}
              className="input textarea"
              rows={3}
              maxLength={500}
              placeholder="Rice and chicken on Monday at 1pm, receipt 0412"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setError('');
              }}
            />
            <p className="field-help">
              An Acticlaim reviewer, not the business, decides. If they agree,
              you get the cash back.
            </p>
          </div>
          {error && <Feedback error>{error}</Feedback>}
          <div className="row" style={{ justifyContent: 'flex-start' }}>
            <Button type="submit" variant="accent" disabled={busy}>
              {busy ? 'Sending…' : 'Send dispute'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
