'use client';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { BadgeCheck, Star } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Feedback } from '@/components/ui/feedback';
import { toast } from '@/components/ui/toast';
import { apiRequest, shortDate } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import type { ratingItem, ratingSummary } from '@/lib/profiles';

type Item = z.infer<typeof ratingItem>;

export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="stars" role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          aria-hidden
          className={n <= Math.round(value) ? 'star-on' : 'star-off'}
        />
      ))}
    </span>
  );
}

// Average, how many, and the spread of stars.
export function RatingSummary({
  data,
}: {
  data: z.infer<typeof ratingSummary>;
}) {
  if (!data.count) return <p className="small-note">No ratings yet.</p>;
  return (
    <div className="rating-summary">
      <div className="rating-average">
        <strong className="num">{data.average?.toFixed(1)}</strong>
        <Stars value={data.average ?? 0} />
        <span className="small-note">
          {data.count} {data.count === 1 ? 'rating' : 'ratings'} from verified
          customers
        </span>
      </div>
      <ul className="rating-bars" aria-label="Ratings by stars">
        {data.stars.map((s) => (
          <li key={s.stars}>
            <span className="num">{s.stars}★</span>
            <span className="meter" aria-hidden>
              <span style={{ width: `${(s.count / data.count) * 100}%` }} />
            </span>
            <span className="num small-note">{s.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// One rating, with the name the business had then and its reply.
export function RatingCard({
  item,
  currentName,
  actions,
}: {
  item: Item;
  currentName: string;
  actions?: React.ReactNode;
}) {
  return (
    <li className="rating-card">
      <div className="row" style={{ alignItems: 'center' }}>
        <span className="icon-line">
          <Stars value={item.stars} size={15} />
          <strong>{item.by}</strong>
          <span className="small-note icon-line">
            <BadgeCheck size={14} aria-hidden /> Verified customer
          </span>
        </span>
        <span className="small-note">
          {shortDate(item.at)}
          {item.edited ? ' · edited' : ''}
        </span>
      </div>
      {item.comment && <p style={{ margin: 0 }}>{item.comment}</p>}
      {item.businessNameThen !== currentName && (
        <p className="small-note" style={{ margin: 0 }}>
          Rated while named {item.businessNameThen}
        </p>
      )}
      {item.reply && (
        <div className="rating-reply">
          <strong>Reply from the business</strong>
          <p style={{ margin: 0 }}>{item.reply.body}</p>
        </div>
      )}
      {actions}
    </li>
  );
}

// Choosing stars and writing a few words.
export function RateDialog({
  open,
  onClose,
  handle,
  businessName,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  handle: string;
  businessName: string;
  initial: { stars: number; comment: string | null } | null;
  onSaved: () => void;
}) {
  const [stars, setStars] = useState(initial?.stars ?? 0);
  const [comment, setComment] = useState(initial?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!stars || busy) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(`businesses/${handle}/ratings`, z.unknown(), {
        method: 'POST',
        body: {
          stars,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        },
      });
      toast('Thanks for your rating');
      onSaved();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof RequestError && cause.code === 'rating_locked'
          ? 'Ratings can be changed for 48 hours only.'
          : cause instanceof RequestError && cause.code === 'rating_unavailable'
            ? 'Only customers this business served can rate it.'
            : 'We could not save your rating. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title={`Rate ${businessName}`}
      description="Shown with your first name. You can change it for 48 hours."
    >
      <form className="grid gap-4" onSubmit={save} noValidate>
        <fieldset className="star-picker">
          <legend>Your rating</legend>
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n}>
              <input
                type="radio"
                name="stars"
                value={n}
                checked={stars === n}
                onChange={() => setStars(n)}
                data-autofocus={n === 1 ? true : undefined}
              />
              <Star
                size={30}
                aria-hidden
                className={n <= stars ? 'star-on' : 'star-off'}
              />
              <span className="sr-only">
                {n} {n === 1 ? 'star' : 'stars'}
              </span>
            </label>
          ))}
        </fieldset>
        <div className="field">
          <label htmlFor="rating-comment">What was it like? (optional)</label>
          <textarea
            id="rating-comment"
            className="input textarea"
            maxLength={500}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            disabled={busy}
          />
          <p className="field-help">Do not share phone numbers or addresses.</p>
        </div>
        {error && <Feedback error>{error}</Feedback>}
        <div className="dialog-foot">
          <Button
            variant="ghost"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            variant="accent"
            type="submit"
            loading={busy}
            disabled={!stars}
          >
            Save rating
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
