'use client';
import Link from 'next/link';
import { Gift, ScanLine } from 'lucide-react';
import { Page } from '@/components/shell/app-shell';
import { Loading } from '@/components/ui/feedback';
import { WorkFailure } from '@/components/work/work-frame';
import { workplaces } from '@/lib/rewards';
import { useApiRead } from '@/lib/use-api-read';

export function StaffTills() {
  const read = useApiRead('staff/workplaces', workplaces);
  return (
    <Page
      eyebrow="Staff"
      title="Your tills"
      intro="Businesses that added you as staff. Confirm customers' purchases here."
    >
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
                    ? 'Tills and prize handovers you can run'
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
      ) : (
        <p className="small-note">
          No business has added you as staff. Ask the owner to add your
          username.
        </p>
      )}
    </Page>
  );
}
