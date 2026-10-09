'use client';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { AreaChart } from '@/components/charts/area-chart';
import { Loading } from '@/components/ui/feedback';
import { naira } from '@/lib/api';
import { analytics } from '@/lib/admin';
import { useApiRead } from '@/lib/use-api-read';
import { AdminFailure, AdminFrame } from './admin-frame';

const count = (n: number) => n.toLocaleString('en-NG');
const day = (d: string) =>
  new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));

function Stats({
  title,
  items,
}: {
  title: string;
  items: [string, string, string?][];
}) {
  return (
    <section aria-label={title} className="grid gap-2">
      <h2 style={{ margin: 0, fontSize: '1rem' }}>{title}</h2>
      <dl className="stat-row" style={{ margin: 0 }}>
        {items.map(([label, value, note]) => (
          <div key={label} className="stat">
            <dt>{label}</dt>
            <dd className="num">{value}</dd>
            {note && (
              <dd
                className="small-note"
                style={{ fontSize: '0.8rem', fontWeight: 400 }}
              >
                {note}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}

// The platform at a glance: people, businesses, money and what is waiting.
export function AdminOverview() {
  const read = useApiRead('admin/analytics', analytics);
  const data = read.data;
  return (
    <AdminFrame
      title="Overview"
      intro="Totals come from the ledger and records, not estimates."
    >
      {read.loading && !data ? (
        <Loading>Loading numbers…</Loading>
      ) : read.error && !data ? (
        <AdminFailure error={read.error} retry={read.refresh} />
      ) : (
        data && (
          <div className="grid gap-6">
            <section className="card grid gap-2" aria-label="Needs attention">
              <h2 style={{ margin: 0, fontSize: '1rem' }}>Needs attention</h2>
              <ul className="stack" style={{ margin: 0, padding: 0 }}>
                {(
                  [
                    [
                      'Campaigns to review',
                      data.queues.campaignsToReview,
                      '/review/campaigns',
                    ],
                    [
                      'Names and logos to review',
                      data.queues.profileChanges,
                      '/admin/renames',
                    ],
                    [
                      'Void disputes',
                      data.queues.disputesOpen,
                      '/review/disputes',
                    ],
                    [
                      'Withdrawals waiting for the provider',
                      data.queues.withdrawalsPending,
                      '/review/payments',
                    ],
                    [
                      'Bill payments waiting for the provider',
                      data.queues.billsPending,
                      '/review/payments',
                    ],
                  ] as const
                ).map(([label, n, href]) => (
                  <li key={label} style={{ listStyle: 'none' }}>
                    <Link className="pick-row" href={href}>
                      <span className="grid">
                        <strong>{label}</strong>
                      </span>
                      <span
                        className={n ? 'chip chip-pending' : 'chip chip-muted'}
                      >
                        {count(n)}
                      </span>
                      <ChevronRight size={18} aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
            <Stats
              title="Money"
              items={[
                [
                  'Funded by businesses',
                  naira(data.money.fundedKobo),
                  `${naira(data.money.funded30dKobo)} in 30 days`,
                ],
                ['Locked in campaigns', naira(data.money.lockedKobo)],
                ['Paid to people', naira(data.money.paidToUsersKobo)],
                ['In wallets now', naira(data.money.inWalletsKobo)],
                ['Withdrawn to banks', naira(data.money.withdrawnKobo)],
                ['Spent on bills', naira(data.money.billsPaidKobo)],
              ]}
            />
            <Stats
              title="People"
              items={[
                ['Accounts', count(data.people.accounts)],
                ['New this week', count(data.people.new7d)],
                ['New in 30 days', count(data.people.new30d)],
                ['Verified phones', count(data.people.verifiedPhones)],
              ]}
            />
            <Stats
              title="Businesses and activity"
              items={[
                [
                  'Businesses',
                  count(data.businesses.total),
                  `${count(data.businesses.new30d)} new in 30 days`,
                ],
                ['Live campaigns', count(data.businesses.liveCampaigns)],
                [
                  'Confirmed purchases',
                  count(data.activity.purchases),
                  `${count(data.activity.purchases7d)} this week`,
                ],
                ['Prizes claimed', count(data.activity.prizeClaims)],
              ]}
            />
            <section className="card">
              <h2 style={{ marginTop: 0, fontSize: '1rem' }}>
                Sign-ups per day, last 14 days
              </h2>
              <AreaChart
                height={220}
                label="Sign-ups per day, last 14 days"
                unit={(v) => `${count(v)} ${v === 1 ? 'sign-up' : 'sign-ups'}`}
                points={data.series.map((d) => ({
                  label: day(d.day),
                  detail: day(d.day),
                  value: d.signups,
                }))}
              />
            </section>
          </div>
        )
      )}
    </AdminFrame>
  );
}
