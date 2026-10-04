'use client';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { z } from 'zod';
import { Page } from '@/components/shell/app-shell';
import { Loading } from '@/components/ui/feedback';
import { WorkFailure } from '@/components/work/work-frame';
import { naira, shortDate } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { sponsorTaskPage } from '@/lib/rewards';
import { useApiRead } from '@/lib/use-api-read';

const businessProfile = z.object({ id: z.uuid(), name: z.string() });
const kinds: Record<string, { label: string; href: (id: string) => string }> = {
  purchase_cashback: {
    label: 'Cash back offer',
    href: (id) => `/business/campaigns/${id}`,
  },
  claim_code: {
    label: 'Prize promotion',
    href: (id) => `/business/promotions/${id}`,
  },
};
const job = { label: 'Job', href: (id: string) => `/sponsor/tasks/${id}` };

function status(review: string, lifecycle: string) {
  if (lifecycle === 'published') return ['Live', 'chip chip-done'] as const;
  if (review === 'approved')
    return ['Approved, not live', 'chip chip-ready'] as const;
  if (review === 'pending_review')
    return ['In review', 'chip chip-pending'] as const;
  if (review === 'changes_required')
    return ['Changes needed', 'chip chip-pending'] as const;
  return ['Not approved', 'chip chip-danger'] as const;
}

export function BusinessHome() {
  const profile = useApiRead('sponsor/profile', businessProfile);
  const tasks = useApiRead(
    profile.data ? 'work/sponsor/tasks?limit=50' : null,
    sponsorTaskPage,
  );
  const missing =
    profile.error instanceof RequestError && profile.error.status === 404;
  return (
    <Page
      eyebrow="For businesses"
      title={profile.data?.name ?? 'Your business'}
      intro="Lock money for real outcomes: confirmed purchases, claimed prizes or accepted work. You only pay for what is verified."
    >
      {profile.loading && !profile.data ? (
        <Loading>Loading your business…</Loading>
      ) : missing ? (
        <section className="card grid gap-3" style={{ maxWidth: 620 }}>
          <h2>Set up your business</h2>
          <p className="small-note">
            Business accounts open once Acticlaim publishes its business terms
            and payments go live. Funding a campaign needs real money movement,
            which is not available in this version.
          </p>
          <p className="small-note">
            Want to run cash back or a prize promotion at launch? Tell us what
            you sell and where.
          </p>
        </section>
      ) : profile.error ? (
        <WorkFailure error={profile.error} retry={profile.refresh} />
      ) : tasks.loading && !tasks.data ? (
        <Loading>Loading campaigns…</Loading>
      ) : tasks.error ? (
        <WorkFailure error={tasks.error} retry={tasks.refresh} />
      ) : tasks.data?.items.length ? (
        <ul className="grid-cards">
          {tasks.data.items.map((task) => {
            const kind = kinds[task.model] ?? job;
            const [text, chip] = status(task.reviewState, task.lifecycle);
            return (
              <li key={task.id}>
                <Link
                  className="card card-link grid gap-2"
                  href={kind.href(task.id)}
                >
                  <div className="row">
                    <p className="eyebrow" style={{ margin: 0 }}>
                      {kind.label}
                    </p>
                    <span className={chip}>{text}</span>
                  </div>
                  <h2 style={{ fontSize: '1.15rem', margin: 0 }}>
                    {task.title}
                  </h2>
                  <p className="small-note">
                    <span className="amount">{naira(task.budgetKobo)}</span>{' '}
                    locked · ends {shortDate(task.endsAt)}
                  </p>
                  <span
                    className="row small-note"
                    style={{ justifyContent: 'flex-start' }}
                  >
                    Manage <ArrowRight size={15} aria-hidden />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <section className="card">
          <h2>No campaigns yet</h2>
          <p className="small-note">
            Your funded offers, promotions and jobs will appear here.
          </p>
        </section>
      )}
    </Page>
  );
}
