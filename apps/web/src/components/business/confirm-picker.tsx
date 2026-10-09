'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ChevronRight, ScanLine } from 'lucide-react';
import { Loading } from '@/components/ui/feedback';
import { WorkFailure } from '@/components/work/work-frame';
import { naira } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { businessOverview } from '@/lib/rewards';
import { useApiRead } from '@/lib/use-api-read';
import { NoBusiness, notEnded } from './business-home';
import { DashHead, DashShell } from './dash-shell';

// The quickest way to the scanner: one live offer opens straight away,
// several are listed to pick from.
export function ConfirmPicker() {
  const router = useRouter();
  const overview = useApiRead('business/overview?days=7', businessOverview);
  const data = overview.data;
  const missing =
    overview.error instanceof RequestError && overview.error.status === 404;
  const live =
    data?.campaigns.filter(
      (c) =>
        c.model === 'purchase_cashback' &&
        c.lifecycle === 'published' &&
        notEnded(c.endsAt),
    ) ?? [];
  const only = live.length === 1 ? live[0]!.id : null;
  useEffect(() => {
    if (only) router.replace(`/business/campaigns/${only}`);
  }, [only, router]);

  return (
    <DashShell
      crumbs={[
        { label: 'Business', href: '/business' },
        { label: 'Confirm a purchase' },
      ]}
      business={data?.business.name}
    >
      <DashHead
        title="Confirm a purchase"
        intro="Scan the code on your customer's phone so they get their cash back."
      />
      {missing ? (
        <NoBusiness />
      ) : overview.error && !data ? (
        <WorkFailure error={overview.error} retry={overview.refresh} />
      ) : !data || only ? (
        <Loading>Opening the scanner…</Loading>
      ) : live.length ? (
        <section className="card grid gap-3" style={{ maxWidth: 620 }}>
          <h2 style={{ margin: 0 }}>Which offer did they buy under?</h2>
          <ul className="stack" style={{ margin: 0, padding: 0 }}>
            {live.map((c) => (
              <li key={c.id} style={{ listStyle: 'none' }}>
                <Link className="pick-row" href={`/business/campaigns/${c.id}`}>
                  <span className="pick-icon" aria-hidden>
                    <ScanLine size={20} />
                  </span>
                  <span className="grid">
                    <strong>{c.title}</strong>
                    <span className="small-note">
                      {naira(c.rewardKobo)} back · {c.capacity - c.used} places
                      left
                    </span>
                  </span>
                  <ChevronRight size={18} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="card grid gap-3" style={{ maxWidth: 620 }}>
          <h2 style={{ margin: 0 }}>No live cash back offer</h2>
          <p className="small-note">
            Customers get a code when they join one of your cash back offers.
            Create an offer first, then confirm their purchases here.
          </p>
          <Link
            className="button button-accent"
            href="/business/campaigns/new"
            style={{ justifySelf: 'start' }}
          >
            Create a cash back offer
          </Link>
        </section>
      )}
    </DashShell>
  );
}
