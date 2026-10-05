'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { ArrowRight, Plus } from 'lucide-react';
import { AreaChart } from '@/components/charts/area-chart';
import { StatusBreakdown } from '@/components/charts/status-breakdown';
import { Button } from '@/components/ui/button';
import { Feedback, Loading } from '@/components/ui/feedback';
import { WorkFailure } from '@/components/work/work-frame';
import { apiRequest, naira } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { businessOverview } from '@/lib/rewards';
import { useApiRead } from '@/lib/use-api-read';
import { CampaignTable } from './campaign-table';
import { DashHead, DashShell } from './dash-shell';
import { FundsBack } from './funds-back';

const dayLabel = (day: string, long: boolean) =>
  new Intl.DateTimeFormat('en-NG', {
    ...(long ? { day: 'numeric', month: 'short' } : { weekday: 'short' }),
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
const fullDay = (day: string) =>
  new Intl.DateTimeFormat('en-NG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));

export function NoBusiness() {
  return (
    <section className="card grid gap-3" style={{ maxWidth: 620 }}>
      <h2 style={{ margin: 0 }}>Set up your business</h2>
      <p className="small-note">
        Create your business to run cash back offers and prize promotions. Every
        reward is paid from money you lock in advance.
      </p>
      <Link
        className="button button-accent"
        href="/business/setup"
        style={{ justifySelf: 'start' }}
      >
        Set up your business
      </Link>
      <p className="small-note">
        Work at a business that uses Acticlaim?{' '}
        <Link className="text-link" href="/staff">
          Open your till
        </Link>
      </p>
    </section>
  );
}

export function BusinessHome() {
  const [days, setDays] = useState<7 | 30>(7);
  const overview = useApiRead(
    `business/overview?days=${days}`,
    businessOverview,
    { keep: true },
  );
  const data = overview.data;
  const missing =
    overview.error instanceof RequestError && overview.error.status === 404;
  const purchases = data?.purchases;
  const total = purchases
    ? purchases.held + purchases.ready + purchases.paid + purchases.voided
    : 0;
  const confirmed = data?.series.reduce((sum, d) => sum + d.purchases, 0) ?? 0;
  const claims = data?.series.reduce((sum, d) => sum + d.claims, 0) ?? 0;
  return (
    <DashShell
      crumbs={[{ label: 'Business', href: '/business' }, { label: 'Overview' }]}
      business={data?.business.name}
    >
      <DashHead
        title="Overview"
        intro="Confirmed purchases, prizes and the money behind them."
        actions={
          data && (
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <div className="segmented" role="group" aria-label="Date range">
                {([7, 30] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={days === d}
                    onClick={() => setDays(d)}
                  >
                    Last {d} days
                  </button>
                ))}
              </div>
              <Link className="button button-accent" href="/business/funds">
                <Plus size={17} aria-hidden /> Add funds
              </Link>
            </div>
          )
        }
      />
      {overview.loading && !data ? (
        <Loading>Loading your business…</Loading>
      ) : missing ? (
        <NoBusiness />
      ) : overview.error && !data ? (
        <WorkFailure error={overview.error} retry={overview.refresh} />
      ) : (
        data &&
        purchases && (
          <div
            className="grid gap-4"
            style={{
              opacity: overview.loading ? 0.6 : 1,
              transition: 'opacity 150ms',
            }}
          >
            <dl className="stat-row" style={{ margin: 0 }}>
              <div className="stat">
                <dt>Available to spend</dt>
                <dd>{naira(data.availableKobo)}</dd>
              </div>
              <div className="stat">
                <dt>Money locked</dt>
                <dd>{naira(data.lockedKobo)}</dd>
              </div>
              <div className="stat">
                <dt>Paid to customers</dt>
                <dd>{naira(data.paidOutKobo)}</dd>
              </div>
              <div className="stat">
                <dt>Live campaigns</dt>
                <dd>{data.live}</dd>
              </div>
              <div className="stat">
                <dt>Shoppers who came back</dt>
                <dd>{purchases.returningShoppers}</dd>
              </div>
            </dl>
            <div className="dash-grid">
              <section className="card" aria-labelledby="activity-heading">
                <div className="card-head">
                  <h2 id="activity-heading">Confirmed purchases</h2>
                  <p>
                    {confirmed.toLocaleString('en-NG')} in the last {data.days}{' '}
                    days
                    {claims
                      ? ` · ${claims.toLocaleString('en-NG')} prizes claimed`
                      : ''}
                  </p>
                </div>
                <AreaChart
                  height={280}
                  label={`Confirmed purchases per day, last ${data.days} days`}
                  unit={(v) =>
                    `${v.toLocaleString('en-NG')} ${v === 1 ? 'purchase' : 'purchases'}`
                  }
                  points={data.series.map((d) => ({
                    label: dayLabel(d.day, data.days > 7),
                    detail: fullDay(d.day),
                    value: d.purchases,
                  }))}
                />
              </section>
              <section className="card" aria-labelledby="status-heading">
                <div className="card-head">
                  <h2 id="status-heading">Cash back status</h2>
                  <p>Every confirmed purchase, all time</p>
                </div>
                <StatusBreakdown
                  total={total}
                  unit="purchases"
                  slices={[
                    {
                      key: 'paid',
                      label: 'Paid to shopper',
                      value: purchases.paid,
                      color: 'var(--color-series-paid)',
                    },
                    {
                      key: 'ready',
                      label: 'Ready to release',
                      value: purchases.ready,
                      color: 'var(--color-series-ready)',
                    },
                    {
                      key: 'held',
                      label: 'Held in refund window',
                      value: purchases.held,
                      color: 'var(--color-series-held)',
                    },
                    {
                      key: 'voided',
                      label: 'Voided',
                      value: purchases.voided,
                      color: 'var(--color-series-voided)',
                    },
                  ]}
                />
              </section>
            </div>
            <section className="card" aria-labelledby="campaigns-heading">
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div className="card-head">
                  <h2 id="campaigns-heading">Campaigns</h2>
                  <p>Offers, promotions and jobs you have funded</p>
                </div>
                <Link
                  className="icon-line small-note"
                  href="/business/campaigns"
                  style={{
                    color: 'var(--color-brand)',
                    fontWeight: 550,
                    whiteSpace: 'nowrap',
                  }}
                >
                  View all <ArrowRight size={15} aria-hidden />
                </Link>
              </div>
              <CampaignTable
                items={data.campaigns.slice(0, 6)}
                empty="Your funded campaigns will appear here."
              />
            </section>
          </div>
        )
      )}
    </DashShell>
  );
}

const newHref: Record<string, string> = {
  purchase_cashback: '/business/campaigns/new',
  claim_code: '/business/promotions/new',
};
const published = z.object({ taskId: z.uuid() });
const notEnded = (endsAt: string) => Date.parse(endsAt) > Date.now();

export function CampaignListPage({
  model,
  title,
  intro,
}: {
  model: string;
  title: string;
  intro: string;
}) {
  const overview = useApiRead('business/overview?days=7', businessOverview);
  const params = useSearchParams();
  const [publishing, setPublishing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const data = overview.data;
  const missing =
    overview.error instanceof RequestError && overview.error.status === 404;
  const items = data?.campaigns.filter((c) => c.model === model) ?? [];
  const ready = items.filter(
    (c) =>
      c.reviewState === 'approved' &&
      c.lifecycle !== 'published' &&
      !c.cancelled &&
      notEnded(c.endsAt),
  );

  async function goLive(id: string) {
    if (publishing) return;
    setPublishing(id);
    setError('');
    try {
      // Publishing is idempotent: repeating it returns the same publication.
      await apiRequest(`work/tasks/${id}/publish`, published, {
        method: 'POST',
        body: {},
      });
      overview.refresh();
    } catch {
      setError(
        'We could not publish this campaign. Check your connection and try again.',
      );
    } finally {
      setPublishing(null);
    }
  }

  return (
    <DashShell
      crumbs={[{ label: 'Business', href: '/business' }, { label: title }]}
      business={data?.business.name}
    >
      <DashHead
        title={title}
        intro={intro}
        actions={
          data &&
          newHref[model] && (
            <Link className="button button-accent" href={newHref[model]}>
              <Plus size={17} aria-hidden /> New
            </Link>
          )
        }
      />
      {overview.loading && !data ? (
        <Loading>Loading…</Loading>
      ) : missing ? (
        <NoBusiness />
      ) : overview.error && !data ? (
        <WorkFailure error={overview.error} retry={overview.refresh} />
      ) : (
        data && (
          <div className="grid gap-4">
            {params.get('created') && (
              <Feedback>
                Created and money locked. Acticlaim reviews it next; you can
                publish it here once it is approved.
              </Feedback>
            )}
            {error && <Feedback error>{error}</Feedback>}
            {ready.length > 0 && (
              <section className="card" aria-labelledby="ready-heading">
                <div className="card-head">
                  <h2 id="ready-heading">Approved, ready to go live</h2>
                  <p>Shoppers see it as soon as you publish.</p>
                </div>
                <ul className="stack">
                  {ready.map((c) => (
                    <li key={c.id} className="row" style={{ flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600 }}>{c.title}</span>
                      <Button
                        type="button"
                        variant="accent"
                        disabled={publishing !== null}
                        onClick={() => void goLive(c.id)}
                      >
                        {publishing === c.id ? 'Publishing…' : 'Go live'}
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <FundsBack items={items} onDone={overview.refresh} />
            <section className="card">
              <CampaignTable
                items={items}
                empty="Nothing here yet. Create one to get started."
              />
            </section>
          </div>
        )
      )}
    </DashShell>
  );
}
