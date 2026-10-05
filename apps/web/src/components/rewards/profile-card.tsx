import { BadgeCheck, BriefcaseBusiness, Phone } from 'lucide-react';
import type { z } from 'zod';
import type { profile } from '@/lib/rewards';

type Profile = z.infer<typeof profile>;
const shortMonth = (value: string) =>
  new Intl.DateTimeFormat('en-NG', { month: 'short', year: 'numeric' }).format(
    new Date(value),
  );
const month = (value: string) =>
  new Intl.DateTimeFormat('en-NG', { month: 'long', year: 'numeric' }).format(
    new Date(value),
  );

// Everything here comes from settled platform records, never self-description.
export function ProfileCard({ data }: { data: Profile }) {
  return (
    <article className="grid gap-5">
      <header
        className="card grid gap-3"
        style={{ borderColor: 'var(--color-ink)', borderWidth: 1.5 }}
      >
        <div
          className="row"
          style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}
        >
          <div style={{ minWidth: 0 }}>
            <h2
              style={{
                fontSize: 'clamp(1.6rem, 6vw, 2.2rem)',
                margin: 0,
                overflowWrap: 'anywhere',
              }}
            >
              {data.displayName ?? data.username}
            </h2>
            {data.username && (
              <p className="small-note num">@{data.username}</p>
            )}
          </div>
          <span className="chip chip-tier">{data.tier.name}</span>
        </div>
        <ul
          className="flex flex-wrap gap-2"
          style={{ listStyle: 'none', margin: 0, padding: 0 }}
        >
          <li className="badge">
            <BadgeCheck size={15} aria-hidden /> Email verified
          </li>
          {data.verified.phone && (
            <li className="badge">
              <Phone size={15} aria-hidden /> Phone verified
            </li>
          )}
        </ul>
        <p className="small-note">
          Member since {month(data.memberSince)}. Every number below is recorded
          by Acticlaim from completed, paid activity.
        </p>
      </header>
      <dl className="stat-row" style={{ margin: 0 }}>
        <div className="stat">
          <dt>Paid jobs</dt>
          <dd className="amount" style={{ fontSize: '1.8rem' }}>
            {data.stats.jobsCompleted}
          </dd>
        </div>
        <div className="stat">
          <dt>Repeat clients</dt>
          <dd className="amount" style={{ fontSize: '1.8rem' }}>
            {data.stats.repeatClients}
          </dd>
        </div>
        <div className="stat">
          <dt>Businesses</dt>
          <dd className="amount" style={{ fontSize: '1.8rem' }}>
            {data.stats.businesses}
          </dd>
        </div>
        <div className="stat">
          <dt>Verified purchases</dt>
          <dd className="amount" style={{ fontSize: '1.8rem' }}>
            {data.stats.purchases}
          </dd>
        </div>
      </dl>
      <section aria-labelledby="work-heading">
        <h3 id="work-heading">Paid work</h3>
        {data.work.length ? (
          <ol className="stack">
            {data.work.map((item, index) => (
              <li key={`${item.completedAt}-${index}`} className="card row">
                <div style={{ minWidth: 0 }}>
                  <p
                    className="truncate"
                    style={{ margin: 0, fontWeight: 600 }}
                  >
                    {item.title}
                  </p>
                  <p
                    className="small-note icon-line"
                    style={{ maxWidth: '100%' }}
                  >
                    <BriefcaseBusiness size={13} aria-hidden />
                    <span className="truncate">{item.businessName}</span>
                  </p>
                </div>
                <span
                  className="small-note num"
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {shortMonth(item.completedAt)}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="small-note">No paid jobs recorded yet.</p>
        )}
      </section>
    </article>
  );
}
