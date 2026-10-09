'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Gift, ScanLine, UserPlus } from 'lucide-react';
import { Page } from '@/components/shell/app-shell';
import { Button } from '@/components/ui/button';
import { Feedback, Loading } from '@/components/ui/feedback';
import { WorkFailure } from '@/components/work/work-frame';
import { apiRequest } from '@/lib/api';
import { workplaces } from '@/lib/rewards';
import { useApiRead } from '@/lib/use-api-read';

export function StaffTills() {
  const read = useApiRead('staff/workplaces', workplaces);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function accept(id: string) {
    if (busy) return;
    setBusy(id);
    setError('');
    try {
      await apiRequest(`staff/invitations/${id}/acceptances`, workplaces, {
        method: 'POST',
        body: {},
      });
      read.refresh();
    } catch {
      setError(
        'We could not accept the invitation. Check your connection and try again.',
      );
    } finally {
      setBusy(null);
    }
  }

  const invitations = read.data?.invitations ?? [];
  return (
    <Page
      eyebrow="Staff"
      title="Work"
      intro="Businesses that added you as staff. Confirm customers' purchases here."
    >
      {invitations.length > 0 && (
        <section
          className="card grid gap-3"
          aria-labelledby="invites-heading"
          style={{ maxWidth: 640, marginBottom: '1rem' }}
        >
          <h2 id="invites-heading" style={{ margin: 0 }}>
            Invitations
          </h2>
          <p className="small-note" style={{ margin: 0 }}>
            While you work for a business you can confirm its customers&apos;
            purchases, but you cannot earn cash back or claim prizes there. Only
            accept if you really work there.
          </p>
          {error && <Feedback error>{error}</Feedback>}
          <ul className="stack">
            {invitations.map((invite) => (
              <li key={invite.id} className="row" style={{ flexWrap: 'wrap' }}>
                <p
                  className="icon-line"
                  style={{ margin: 0, fontWeight: 600, flex: '1 1 12rem' }}
                >
                  <UserPlus
                    size={18}
                    aria-hidden
                    style={{ color: 'var(--color-brand-text)' }}
                  />
                  {invite.business}
                </p>
                <Button
                  type="button"
                  variant="accent"
                  disabled={busy !== null}
                  loading={busy === invite.id}
                  onClick={() => void accept(invite.id)}
                >
                  {busy === invite.id ? 'Accepting…' : 'Accept'}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {read.loading && !read.data ? (
        <Loading>Loading your workplaces…</Loading>
      ) : read.error && !read.data ? (
        <WorkFailure error={read.error} retry={read.refresh} />
      ) : read.data?.items.length ? (
        <div className="grid gap-4" style={{ maxWidth: 640 }}>
          {read.data.items.map((business) => (
            <section key={business.id} className="card">
              <div className="card-head">
                <h2>{business.name}</h2>
                <p>
                  {business.tills.length || business.prizes.length
                    ? 'Offers you can confirm and prizes you can hand over'
                    : 'Nothing live right now.'}
                </p>
              </div>
              <ul className="stack">
                {business.prizes.map((prize) => (
                  <li key={prize.id}>
                    <Link
                      className="button button-outline"
                      href={`/staff/prizes/${prize.id}`}
                    >
                      <Gift size={17} aria-hidden /> Hand over: {prize.item}
                    </Link>
                  </li>
                ))}
                {business.tills.map((till) => (
                  <li key={till.id}>
                    <Link
                      className="button button-outline"
                      href={`/business/campaigns/${till.id}`}
                    >
                      <ScanLine size={17} aria-hidden /> {till.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : invitations.length ? null : (
        <p className="small-note">
          No business has added you as staff. Ask the owner to add your
          username.
        </p>
      )}
    </Page>
  );
}
