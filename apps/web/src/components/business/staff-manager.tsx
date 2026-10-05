'use client';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { DashHead, DashShell } from './dash-shell';
import { NoBusiness } from './business-home';
import { Button } from '@/components/ui/button';
import { Feedback, Loading } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { WorkFailure } from '@/components/work/work-frame';
import { apiRequest, naira, newId, shortDate } from '@/lib/api';
import { TriangleAlert } from 'lucide-react';
import { RequestError } from '@/lib/auth-client';
import { staffList } from '@/lib/rewards';
import { useApiRead } from '@/lib/use-api-read';

function addError(error: unknown) {
  if (error instanceof RequestError) {
    if (error.status === 404)
      return 'No active Acticlaim account has that username. Ask them to check it on their profile.';
    if (error.code === 'staff_unavailable')
      return 'They are already on your staff or invited, or the limit of 20 staff is reached.';
    if (error.status === 400) return 'Enter their Acticlaim username.';
  }
  return 'We could not add them. Check your connection and try again.';
}

export function StaffManager() {
  const staff = useApiRead('business/staff', staffList);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const attempt = useRef<{ username: string; id: string } | null>(null);
  const missing =
    staff.error instanceof RequestError && staff.error.status === 404;

  async function add(event: FormEvent) {
    event.preventDefault();
    const value = username.trim();
    if (busy) return;
    if (!value) {
      setError('Enter their Acticlaim username.');
      return;
    }
    if (attempt.current?.username !== value)
      attempt.current = { username: value, id: newId() };
    setBusy(true);
    setError('');
    try {
      await apiRequest('business/staff', staffList, {
        method: 'POST',
        body: attempt.current,
      });
      attempt.current = null;
      setUsername('');
      staff.refresh();
    } catch (cause) {
      if (cause instanceof RequestError && cause.status < 500)
        attempt.current = null;
      setError(addError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError('');
    try {
      await apiRequest(`business/staff/${id}/removals`, staffList, {
        method: 'POST',
        body: {},
      });
      setConfirming(null);
      staff.refresh();
    } catch {
      setError(
        'We could not remove them. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <DashShell
      crumbs={[{ label: 'Business', href: '/business' }, { label: 'Staff' }]}
    >
      <DashHead
        title="Staff"
        intro="People who can confirm purchases at your till. They cannot void purchases, move money or change campaigns."
      />
      {staff.loading && !staff.data ? (
        <Loading>Loading staff…</Loading>
      ) : missing ? (
        <NoBusiness />
      ) : staff.error && !staff.data ? (
        <WorkFailure error={staff.error} retry={staff.refresh} />
      ) : (
        <div className="dash-grid">
          <section className="card" aria-labelledby="staff-heading">
            <div className="card-head">
              <h2 id="staff-heading">Your team</h2>
              <p>
                Each person must accept your invitation first. Staff cannot earn
                cash back or claim prizes from your business, and each can
                confirm at most 100 purchases a day.
              </p>
            </div>
            {staff.data?.items.length ? (
              <ul className="stack">
                {staff.data.items.map((m) => (
                  <li key={m.id} className="grid gap-2">
                    <div className="row" style={{ flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0, flex: '1 1 10rem' }}>
                        <p style={{ margin: 0, fontWeight: 600 }}>
                          {m.displayName ?? m.username ?? 'Staff member'}
                        </p>
                        <p className="small-note">
                          {m.username ? `@${m.username} · ` : ''}
                          {m.accepted ? 'added' : 'invited'}{' '}
                          {shortDate(m.addedAt)}
                        </p>
                      </div>
                      {!m.accepted && (
                        <span className="chip chip-pending">
                          Waiting to accept
                        </span>
                      )}
                      {confirming !== m.id && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy}
                          onClick={() => setConfirming(m.id)}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                    {m.accepted && (
                      <p className="small-note" style={{ margin: 0 }}>
                        Confirmed {m.confirmedToday} today · {m.confirmedWeek}{' '}
                        this week · {naira(m.weekCashbackKobo)} cash back this
                        week
                      </p>
                    )}
                    {m.repeatShoppers > 0 && (
                      <p
                        className="icon-line small-note"
                        style={{ margin: 0, color: 'var(--color-danger)' }}
                      >
                        <TriangleAlert size={16} aria-hidden />
                        Confirmed the same{' '}
                        {m.repeatShoppers === 1
                          ? 'shopper'
                          : `${m.repeatShoppers} shoppers`}{' '}
                        3 or more times this week. Check these were real sales.
                      </p>
                    )}
                    {confirming === m.id && (
                      <div className="confirm-strip">
                        <p style={{ margin: 0 }}>
                          Remove {m.displayName ?? m.username}? They lose till
                          access at once.
                        </p>
                        <div
                          className="row"
                          style={{ justifyContent: 'flex-start' }}
                        >
                          <Button
                            type="button"
                            disabled={busy}
                            onClick={() => void remove(m.id)}
                          >
                            Yes, remove
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setConfirming(null)}
                          >
                            Keep
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small-note">
                No staff yet. Only you can confirm purchases.
              </p>
            )}
          </section>
          <form
            className="card grid gap-4"
            onSubmit={add}
            noValidate
            aria-labelledby="add-heading"
          >
            <h2 id="add-heading" style={{ margin: 0 }}>
              Add someone
            </h2>
            <Field
              id="staff-username"
              label="Their Acticlaim username"
              placeholder="@ada"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError('');
              }}
              hint="They find it on their profile. They accept under Staff, then see your tills there."
            />
            {error && <Feedback error>{error}</Feedback>}
            <Button variant="accent" type="submit" disabled={busy}>
              {busy ? 'Inviting…' : 'Invite to staff'}
            </Button>
          </form>
        </div>
      )}
    </DashShell>
  );
}
