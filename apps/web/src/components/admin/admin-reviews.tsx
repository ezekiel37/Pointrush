'use client';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Feedback, Loading } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { toast } from '@/components/ui/toast';
import { apiRequest } from '@/lib/api';
import { ratingItem } from '@/lib/profiles';
import { useApiRead } from '@/lib/use-api-read';
import { RatingCard } from '@/components/business/ratings';
import { AdminFailure, AdminFrame } from './admin-frame';

const recent = z.object({
  items: z.array(
    ratingItem.extend({
      businessNow: z.string(),
      username: z.string().nullable(),
      removed: z.boolean(),
      removedReason: z.string().nullable(),
    }),
  ),
});

// The latest ratings everywhere. Remove only for abuse or private details,
// never because a business dislikes a fair rating.
export function AdminReviews() {
  const read = useApiRead('admin/ratings', recent);
  const [removing, setRemoving] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove(event: FormEvent) {
    event.preventDefault();
    if (!removing || busy || reason.trim().length < 3) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(`admin/ratings/${removing}/removals`, z.unknown(), {
        method: 'POST',
        body: { reason: reason.trim() },
      });
      toast('Rating removed');
      setRemoving(null);
      setReason('');
      read.refresh();
    } catch {
      setError(
        'Not removed. You cannot remove ratings of your own business, and each is removed once.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminFrame
      title="Reviews"
      intro="Latest ratings from verified customers. Remove one only for abuse, threats or private details such as phone numbers. The business sees your reason."
    >
      {read.loading && !read.data ? (
        <Loading>Loading reviews…</Loading>
      ) : read.error && !read.data ? (
        <AdminFailure error={read.error} retry={read.refresh} />
      ) : read.data?.items.length ? (
        <ul className="rating-list" style={{ maxWidth: 760 }}>
          {read.data.items.map((item) => (
            <RatingCard
              key={item.id}
              item={item}
              currentName={item.businessNow}
              actions={
                <div className="row" style={{ alignItems: 'center' }}>
                  <span className="small-note">
                    {item.businessNow}
                    {item.username ? ` · by @${item.username}` : ''}
                  </span>
                  {item.removed ? (
                    <span className="chip chip-muted">
                      Removed: {item.removedReason}
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setError('');
                        setRemoving(item.id);
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              }
            />
          ))}
        </ul>
      ) : (
        <p className="small-note">No ratings yet.</p>
      )}
      <Dialog
        open={removing !== null}
        onClose={() => !busy && setRemoving(null)}
        title="Remove this rating?"
        description="It stops counting and is hidden from the business page. This is recorded with your reason."
      >
        <form className="grid gap-4" onSubmit={remove} noValidate>
          <Field
            id="removal-reason"
            label="Reason"
            placeholder="Contains a phone number"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={busy}
            data-autofocus
          />
          {error && <Feedback error>{error}</Feedback>}
          <div className="dialog-foot">
            <Button
              variant="ghost"
              type="button"
              onClick={() => setRemoving(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              type="submit"
              loading={busy}
              disabled={reason.trim().length < 3}
            >
              Remove rating
            </Button>
          </div>
        </form>
      </Dialog>
    </AdminFrame>
  );
}
