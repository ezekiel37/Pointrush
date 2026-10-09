'use client';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { MessageSquareReply } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Feedback, Loading } from '@/components/ui/feedback';
import { toast } from '@/components/ui/toast';
import { WorkFailure } from '@/components/work/work-frame';
import { apiRequest } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { businessDetails, businessRatings } from '@/lib/profiles';
import { useApiRead } from '@/lib/use-api-read';
import { NoBusiness } from './business-home';
import { DashHead, DashShell } from './dash-shell';
import { RatingCard, RatingSummary } from './ratings';

// What verified customers said, with one public reply each.
export function BusinessReviews() {
  const read = useApiRead('sponsor/ratings', businessRatings);
  const details = useApiRead('sponsor/profile/details', businessDetails);
  const [replying, setReplying] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const missing =
    read.error instanceof RequestError && read.error.status === 404;
  const name = details.data?.name ?? '';

  async function reply(event: FormEvent) {
    event.preventDefault();
    if (!replying || busy || !body.trim()) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(`sponsor/ratings/${replying}/replies`, z.unknown(), {
        method: 'POST',
        body: { body: body.trim() },
      });
      toast('Reply posted');
      setReplying(null);
      setBody('');
      read.refresh();
    } catch (cause) {
      setError(
        cause instanceof RequestError && cause.code === 'already_replied'
          ? 'You already replied to this rating.'
          : 'We could not post your reply. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <DashShell
      crumbs={[{ label: 'Business', href: '/business' }, { label: 'Reviews' }]}
      business={details.data?.name}
    >
      <DashHead
        title="Reviews"
        intro="Ratings from customers you served. You can reply once to each, publicly. Only Acticlaim can remove a rating, for abuse or private details."
      />
      {read.loading && !read.data ? (
        <Loading>Loading reviews…</Loading>
      ) : missing ? (
        <NoBusiness />
      ) : read.error && !read.data ? (
        <WorkFailure error={read.error} retry={read.refresh} />
      ) : (
        read.data && (
          <div className="grid gap-5" style={{ maxWidth: 760 }}>
            <section className="card">
              <RatingSummary data={read.data.summary} />
            </section>
            {read.data.items.length ? (
              <ul className="rating-list">
                {read.data.items.map((item) => (
                  <RatingCard
                    key={item.id}
                    item={item}
                    currentName={name}
                    actions={
                      item.removed ? (
                        <p className="small-note" style={{ margin: 0 }}>
                          Removed by Acticlaim: {item.removedReason}
                        </p>
                      ) : !item.reply ? (
                        <Button
                          type="button"
                          variant="ghost"
                          style={{ justifySelf: 'start' }}
                          onClick={() => {
                            setError('');
                            setBody('');
                            setReplying(item.id);
                          }}
                        >
                          <MessageSquareReply size={16} aria-hidden /> Reply
                        </Button>
                      ) : null
                    }
                  />
                ))}
              </ul>
            ) : (
              <p className="small-note">
                No ratings yet. Customers you served can rate you from your
                business page.
              </p>
            )}
            <Dialog
              open={replying !== null}
              onClose={() => !busy && setReplying(null)}
              title="Reply to this rating"
              description="Everyone can read it, and you cannot edit it later. Be polite and say what you fixed."
            >
              <form className="grid gap-4" onSubmit={reply} noValidate>
                <div className="field">
                  <label htmlFor="reply-body">Your reply</label>
                  <textarea
                    id="reply-body"
                    className="input textarea"
                    maxLength={500}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    disabled={busy}
                    data-autofocus
                  />
                </div>
                {error && <Feedback error>{error}</Feedback>}
                <div className="dialog-foot">
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => setReplying(null)}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="accent"
                    type="submit"
                    loading={busy}
                    disabled={!body.trim()}
                  >
                    Post reply
                  </Button>
                </div>
              </form>
            </Dialog>
          </div>
        )
      )}
    </DashShell>
  );
}
