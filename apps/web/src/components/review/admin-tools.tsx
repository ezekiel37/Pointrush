'use client';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ShieldAlert } from 'lucide-react';
import { z } from 'zod';
import { ReviewFrame } from './review-frame';
import { Button } from '@/components/ui/button';
import { Feedback, Loading } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { WorkFailure } from '@/components/work/work-frame';
import { ReviewAccess } from '@/components/work/review-access';
import { apiRequest, money, naira, newId, shortDate } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { useApiRead } from '@/lib/use-api-read';

const date = z.iso.datetime({ offset: true });
const account = z.object({
  id: z.uuid(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  accessState: z.string(),
  phoneVerified: z.boolean(),
  business: z.boolean(),
  withdrawalsLocked: z.boolean().default(false),
  createdAt: date,
  history: z.array(
    z.object({
      fromState: z.string(),
      toState: z.string(),
      reason: z.string(),
      by: z.string().nullable(),
      at: date,
    }),
  ),
});
const flagged = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      provider: z.string(),
      eventId: z.string(),
      type: z.string(),
      reference: z.string().nullable(),
      amountKobo: money.nullable(),
      currency: z.string().nullable(),
      outcome: z.string(),
      receivedAt: date,
      review: z.object({ note: z.string(), at: date }).nullable(),
    }),
  ),
});
type Account = z.infer<typeof account>;

const denied = (error: unknown) =>
  error instanceof RequestError &&
  (error.status === 401 || error.status === 403);

export function AccountTools() {
  const [username, setUsername] = useState('');
  const [found, setFound] = useState<Account | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsAccess, setNeedsAccess] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const attempt = useRef<{ key: string; id: string } | null>(null);

  async function find(event: FormEvent) {
    event.preventDefault();
    if (busy || !username.trim()) return;
    setBusy(true);
    setError('');
    setFound(null);
    try {
      setFound(
        await apiRequest(
          `admin/accounts?username=${encodeURIComponent(username.trim())}`,
          account,
        ),
      );
    } catch (cause) {
      setNeedsAccess(denied(cause));
      setError(
        cause instanceof RequestError && cause.status === 404
          ? 'No account has that username.'
          : denied(cause)
            ? ''
            : 'We could not look that up. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function change(toState: 'active' | 'suspended') {
    if (!found || busy) return;
    if (reason.trim().length < 3) {
      setError('Write the reason. The person may see it on appeal.');
      return;
    }
    const key = `${found.id}:${toState}:${reason.trim()}`;
    if (attempt.current?.key !== key) attempt.current = { key, id: newId() };
    setBusy(true);
    setError('');
    try {
      setFound(
        await apiRequest(`admin/accounts/${found.id}/access`, account, {
          method: 'POST',
          body: { id: attempt.current.id, toState, reason: reason.trim() },
        }),
      );
      attempt.current = null;
      setReason('');
    } catch (cause) {
      if (cause instanceof RequestError && cause.status < 500)
        attempt.current = null;
      setNeedsAccess(denied(cause));
      setError(
        cause instanceof RequestError &&
          cause.code === 'access_change_unavailable'
          ? toState === 'active'
            ? 'Another reviewer must unfreeze this account: the person who froze it cannot undo it alone.'
            : 'This change is not allowed: the account may be closed, already in that state, or your own.'
          : 'We could not record the change. Try again; it is recorded once.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function unlock() {
    if (!found || busy) return;
    setBusy(true);
    setError('');
    try {
      setFound(
        await apiRequest(
          `admin/accounts/${found.id}/withdrawal-unlocks`,
          account,
          { method: 'POST', body: {} },
        ),
      );
      setUnlocking(false);
    } catch (cause) {
      setNeedsAccess(denied(cause));
      setError(
        cause instanceof RequestError && cause.code === 'unlock_unavailable'
          ? 'You cannot unlock your own withdrawals.'
          : 'We could not unlock withdrawals. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ReviewFrame
      title="Accounts"
      intro="Freeze an account while you investigate abuse. A frozen account cannot earn, claim, buy or withdraw. Every change is recorded."
    >
      <div className="grid gap-4" style={{ maxWidth: 640, marginTop: '1rem' }}>
        {needsAccess && <ReviewAccess />}
        <form className="card grid gap-3" onSubmit={find} noValidate>
          <Field
            id="lookup-username"
            label="Username"
            placeholder="@ada"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Button type="submit" disabled={busy}>
            {busy && !found ? 'Looking up…' : 'Find account'}
          </Button>
        </form>
        {error && <Feedback error>{error}</Feedback>}
        {found && (
          <section
            className="card grid gap-4"
            aria-labelledby="account-heading"
          >
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <div>
                <h2 id="account-heading" style={{ margin: 0 }}>
                  {found.displayName ?? found.username}
                </h2>
                <p className="small-note">
                  @{found.username} · joined {shortDate(found.createdAt)} ·{' '}
                  {found.phoneVerified ? 'phone verified' : 'no phone'}
                  {found.business ? ' · runs a business' : ''}
                </p>
              </div>
              <span
                className={
                  found.accessState === 'active'
                    ? 'chip chip-done'
                    : 'chip chip-danger'
                }
              >
                {found.accessState === 'active' ? 'Active' : 'Frozen'}
              </span>
            </div>
            {found.accessState !== 'closed' && (
              <>
                <div className="field">
                  <label htmlFor="access-reason">Reason</label>
                  <textarea
                    id="access-reason"
                    className="input textarea"
                    rows={2}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
                {found.accessState === 'active' ? (
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => void change('suspended')}
                  >
                    Freeze account
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="accent"
                    disabled={busy}
                    onClick={() => void change('active')}
                  >
                    Unfreeze account
                  </Button>
                )}
              </>
            )}
            {found.withdrawalsLocked && (
              <div className="confirm-strip">
                <p className="icon-line" style={{ margin: 0 }}>
                  <ShieldAlert
                    size={18}
                    aria-hidden
                    style={{ color: 'var(--color-danger)' }}
                  />
                  Withdrawals locked by the account owner (&ldquo;This
                  wasn&apos;t me&rdquo;). Contact them and confirm a password
                  change before unlocking.
                </p>
                {unlocking ? (
                  <div className="row" style={{ justifyContent: 'flex-start' }}>
                    <Button
                      type="button"
                      variant="accent"
                      disabled={busy}
                      onClick={() => void unlock()}
                    >
                      Yes, I checked: unlock
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setUnlocking(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    style={{ justifySelf: 'start' }}
                    disabled={busy}
                    onClick={() => setUnlocking(true)}
                  >
                    Unlock withdrawals
                  </Button>
                )}
              </div>
            )}
            {found.history.length > 0 && (
              <dl className="terms-list">
                {found.history.map((h) => (
                  <div key={h.at + h.toState}>
                    <dt>
                      {shortDate(h.at)}
                      {h.by ? ` · @${h.by}` : ''}
                    </dt>
                    <dd>
                      {h.toState === 'suspended' ? 'Frozen' : 'Unfrozen'}:{' '}
                      {h.reason}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        )}
      </div>
    </ReviewFrame>
  );
}

const outcomeText: Record<string, string> = {
  mismatch: 'Amount or currency did not match',
  unknown_reference: 'No matching request',
};

export function PaymentReviews() {
  const read = useApiRead('admin/payments/flagged', flagged);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function save(id: string) {
    const note = (notes[id] ?? '').trim();
    if (note.length < 3) {
      setError('Write what you found and what was done.');
      return;
    }
    setBusy(id);
    setError('');
    try {
      await apiRequest(`admin/payments/events/${id}/reviews`, z.unknown(), {
        method: 'POST',
        body: { note },
      });
      read.refresh();
    } catch {
      setError('We could not save the note. Try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <ReviewFrame
      title="Flagged payments"
      intro="Verified provider events that credited nothing because they did not match. Fix them with the provider, then record what you did. Notes never move money."
    >
      <div className="grid gap-4" style={{ maxWidth: 720, marginTop: '1rem' }}>
        {error && <Feedback error>{error}</Feedback>}
        {read.loading && !read.data ? (
          <Loading>Loading flagged payments…</Loading>
        ) : read.error && denied(read.error) ? (
          <ReviewAccess />
        ) : read.error ? (
          <WorkFailure error={read.error} retry={read.refresh} />
        ) : read.data?.items.length ? (
          <ul className="stack">
            {read.data.items.map((e) => (
              <li key={e.id} className="card grid gap-3">
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 600 }}>
                      {outcomeText[e.outcome] ?? e.outcome}
                    </p>
                    <p className="small-note">
                      {e.provider} · {e.type} · {shortDate(e.receivedAt)}
                    </p>
                  </div>
                  <span className="amount">
                    {e.amountKobo ? naira(e.amountKobo) : '—'}
                    {e.currency && e.currency !== 'NGN' ? ` ${e.currency}` : ''}
                  </span>
                </div>
                <p className="small-note mono" style={{ margin: 0 }}>
                  Event {e.eventId}
                  {e.reference ? ` · reference ${e.reference}` : ''}
                </p>
                {e.review ? (
                  <Feedback>
                    {e.review.note} ({shortDate(e.review.at)})
                  </Feedback>
                ) : (
                  <div className="grid gap-2">
                    <label className="field-label" htmlFor={`note-${e.id}`}>
                      What you found and did
                    </label>
                    <textarea
                      id={`note-${e.id}`}
                      className="input textarea"
                      rows={2}
                      maxLength={1000}
                      value={notes[e.id] ?? ''}
                      onChange={(ev) =>
                        setNotes((n) => ({ ...n, [e.id]: ev.target.value }))
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => void save(e.id)}
                      style={{ justifySelf: 'start' }}
                    >
                      {busy === e.id ? 'Saving…' : 'Save note'}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="small-note">No flagged payments.</p>
        )}
      </div>
    </ReviewFrame>
  );
}
