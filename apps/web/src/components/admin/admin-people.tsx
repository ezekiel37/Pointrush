'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { ChevronRight, Search, Store, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Feedback, Loading } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { apiRequest, naira, shortDate } from '@/lib/api';
import { personDetail, searchResults } from '@/lib/admin';
import { z } from 'zod';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { useApiRead } from '@/lib/use-api-read';
import { AdminFailure, AdminFrame, denied } from './admin-frame';

type Results = z.infer<typeof searchResults>['items'];

// Find anyone by username, name, email or business name.
export function AdminPeople() {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (busy || query.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const found = await apiRequest(
        `admin/search?q=${encodeURIComponent(query.trim())}`,
        searchResults,
      );
      setItems(found.items);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminFrame
      title="People and businesses"
      intro="Search by username, name, email or business name. Every search and every account you open is recorded."
    >
      <div className="grid gap-5" style={{ maxWidth: 760 }}>
        <form className="card grid gap-3" onSubmit={search} noValidate>
          <Field
            id="admin-search"
            label="Search"
            placeholder="@ada, ada@example.com or Mama Put"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
          />
          <Button
            variant="accent"
            type="submit"
            loading={busy}
            disabled={query.trim().length < 2}
            style={{ justifySelf: 'start' }}
          >
            <Search size={17} aria-hidden /> Search
          </Button>
        </form>
        {error !== null &&
          (denied(error) ? (
            <AdminFailure error={error} retry={() => setError(null)} />
          ) : (
            <Feedback error>We could not search. Try again.</Feedback>
          ))}
        {items &&
          (items.length ? (
            <ul
              className="stack"
              style={{ margin: 0, padding: 0 }}
              aria-label="Results"
            >
              {items.map((p) => (
                <li key={p.id} style={{ listStyle: 'none' }}>
                  <Link className="pick-row" href={`/admin/people/${p.id}`}>
                    <span className="pick-icon" aria-hidden>
                      {p.businessName ? (
                        <Store size={20} />
                      ) : (
                        <UserRound size={20} />
                      )}
                    </span>
                    <span className="grid" style={{ minWidth: 0 }}>
                      <strong className="truncate">
                        {p.businessName ??
                          p.displayName ??
                          p.username ??
                          'No profile yet'}
                      </strong>
                      <span className="small-note truncate">
                        {[
                          p.handle && `@${p.handle}`,
                          p.username && `@${p.username}`,
                          p.email,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    {p.accessState !== 'active' && (
                      <span className="chip chip-danger">{p.accessState}</span>
                    )}
                    <ChevronRight size={18} aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small-note">Nobody matches that.</p>
          ))}
      </div>
    </AdminFrame>
  );
}

export function AdminPerson({ id }: { id: string }) {
  const read = useApiRead(`admin/accounts/${id}`, personDetail);
  const p = read.data;
  const [handleOpen, setHandleOpen] = useState(false);
  const [newHandle, setNewHandle] = useState('');
  const [handleReason, setHandleReason] = useState('');
  const [handleBusy, setHandleBusy] = useState(false);
  const [handleError, setHandleError] = useState('');

  async function changeHandle(event: FormEvent) {
    event.preventDefault();
    if (!p?.businessProfile || handleBusy) return;
    setHandleBusy(true);
    setHandleError('');
    try {
      await apiRequest(
        `admin/businesses/${p.businessProfile.id}/handle`,
        z.unknown(),
        {
          method: 'POST',
          body: {
            handle: newHandle.trim().replace(/^@/, '').toLowerCase(),
            reason: handleReason.trim(),
          },
        },
      );
      toast('Handle changed');
      setHandleOpen(false);
      setNewHandle('');
      setHandleReason('');
      read.refresh();
    } catch {
      setHandleError(
        'Not changed. The handle may be taken or reserved, or this is your own business.',
      );
    } finally {
      setHandleBusy(false);
    }
  }
  return (
    <AdminFrame
      title={p?.businessProfile?.name ?? p?.displayName ?? 'Account'}
      section={{ label: 'People', href: '/admin/people' }}
    >
      {read.loading && !p ? (
        <Loading>Loading account…</Loading>
      ) : read.error && !p ? (
        <AdminFailure error={read.error} retry={read.refresh} />
      ) : (
        p && (
          <div className="grid gap-5" style={{ maxWidth: 820 }}>
            <section className="card">
              <dl className="terms-list">
                {(
                  [
                    ['Username', p.username ? `@${p.username}` : 'None yet'],
                    [
                      'Earlier usernames',
                      p.formerUsernames.length
                        ? p.formerUsernames.map((u) => `@${u}`).join(', ')
                        : 'None',
                    ],
                    ['Email', p.email ?? 'Unknown'],
                    [
                      'Signed up as',
                      p.accountType === 'business' ? 'Business' : 'Personal',
                    ],
                    ['Status', p.accessState],
                    ['Phone', p.phoneVerified ? 'Verified' : 'Not verified'],
                    [
                      'Withdrawals',
                      p.withdrawalsLocked ? 'Locked by the owner' : 'Normal',
                    ],
                    ['Joined', shortDate(p.createdAt)],
                    ['Wallet', naira(p.walletKobo)],
                    ['Confirmed purchases', String(p.purchases)],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
            {p.businessProfile && (
              <section className="card">
                <h2 style={{ marginTop: 0 }}>Business</h2>
                <dl className="terms-list">
                  {(
                    [
                      ['Name', p.businessProfile.name],
                      [
                        'Handle',
                        p.businessProfile.handles[0]
                          ? `@${p.businessProfile.handles[0]}`
                          : 'None',
                      ],
                      [
                        'Earlier handles',
                        p.businessProfile.handles.length > 1
                          ? p.businessProfile.handles
                              .slice(1)
                              .map((h) => `@${h}`)
                              .join(', ')
                          : 'None',
                      ],
                      [
                        'Earlier names',
                        p.businessProfile.formerNames.length
                          ? p.businessProfile.formerNames.join(', ')
                          : 'None',
                      ],
                      ['Campaigns', String(p.businessProfile.campaigns)],
                      ['Funded in total', naira(p.businessProfile.fundedKobo)],
                      ['Available', naira(p.businessProfile.availableKobo)],
                      [
                        'Locked in campaigns',
                        naira(p.businessProfile.lockedKobo),
                      ],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
            {p.businessProfile && (
              <Button
                type="button"
                variant="outline"
                style={{ justifySelf: 'start' }}
                onClick={() => {
                  setHandleError('');
                  setHandleOpen(true);
                }}
              >
                Change business handle
              </Button>
            )}
            <Dialog
              open={handleOpen}
              onClose={() => !handleBusy && setHandleOpen(false)}
              title="Change this business's handle"
              description="Only for impersonation or a legal complaint. The old handle stays reserved and leads to the new one. The owner sees your reason."
            >
              <form className="grid gap-4" onSubmit={changeHandle} noValidate>
                <Field
                  id="admin-handle"
                  label="New handle"
                  value={newHandle}
                  onChange={(event) => setNewHandle(event.target.value)}
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={handleBusy}
                  data-autofocus
                />
                <Field
                  id="admin-handle-reason"
                  label="Reason"
                  placeholder="Trademark complaint from Shoprite Holdings"
                  value={handleReason}
                  onChange={(event) => setHandleReason(event.target.value)}
                  disabled={handleBusy}
                />
                {handleError && <Feedback error>{handleError}</Feedback>}
                <div className="dialog-foot">
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => setHandleOpen(false)}
                    disabled={handleBusy}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="accent"
                    type="submit"
                    loading={handleBusy}
                    disabled={
                      newHandle.trim().length < 3 ||
                      handleReason.trim().length < 3
                    }
                  >
                    Change handle
                  </Button>
                </div>
              </form>
            </Dialog>
            {p.history.length > 0 && (
              <section className="card">
                <h2 style={{ marginTop: 0 }}>Access changes</h2>
                <ul className="stack">
                  {p.history.map((h) => (
                    <li key={h.at}>
                      {h.fromState} → {h.toState} · {h.reason}
                      <span className="small-note">
                        {' '}
                        {h.by ? `@${h.by}` : 'system'} · {shortDate(h.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {p.username && (
              <Link
                className="button button-outline"
                href={`/review/accounts?username=${encodeURIComponent(p.username)}`}
                style={{ justifySelf: 'start' }}
              >
                Freeze or unfreeze this account
              </Link>
            )}
          </div>
        )
      )}
    </AdminFrame>
  );
}
