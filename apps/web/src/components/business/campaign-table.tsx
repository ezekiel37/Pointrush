import Link from 'next/link';
import type { z } from 'zod';
import { naira, shortDate } from '@/lib/api';
import type { businessCampaign } from '@/lib/rewards';

type Campaign = z.infer<typeof businessCampaign>;
const kinds: Record<
  string,
  { label: string; href: (id: string) => string; unit: string }
> = {
  purchase_cashback: {
    label: 'Cash back',
    href: (id) => `/business/campaigns/${id}`,
    unit: 'buyers',
  },
  claim_code: {
    label: 'Prize promotion',
    href: (id) => `/business/promotions/${id}`,
    unit: 'prizes',
  },
};
const job = {
  label: 'Job',
  href: (id: string) => `/sponsor/tasks/${id}`,
  unit: 'places',
};

export function campaignStatus(
  c: Pick<Campaign, 'reviewState' | 'lifecycle' | 'endsAt'>,
) {
  if (c.lifecycle === 'published')
    return Date.parse(c.endsAt) > Date.now()
      ? (['Live', 'chip chip-done'] as const)
      : (['Ended', 'chip chip-muted'] as const);
  if (c.reviewState === 'approved')
    return ['Approved', 'chip chip-ready'] as const;
  if (c.reviewState === 'pending_review')
    return ['In review', 'chip chip-pending'] as const;
  if (c.reviewState === 'changes_required')
    return ['Changes needed', 'chip chip-pending'] as const;
  return ['Not approved', 'chip chip-danger'] as const;
}

export function CampaignTable({
  items,
  empty,
}: {
  items: Campaign[];
  empty: string;
}) {
  if (!items.length) return <p className="small-note">{empty}</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Campaign</th>
            <th scope="col">Reward</th>
            <th scope="col">Used</th>
            <th scope="col">Ends</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => {
            const kind = kinds[c.model] ?? job;
            const [label, chip] = campaignStatus(c);
            const share = c.capacity ? Math.min(1, c.used / c.capacity) : 0;
            return (
              <tr key={c.id}>
                <td>
                  <Link href={kind.href(c.id)}>{c.title}</Link>
                  <span className="sub">{kind.label}</span>
                  {c.reviewNote && (
                    <span className="sub review-note">
                      Reviewer: {c.reviewNote}
                    </span>
                  )}
                </td>
                <td>{naira(c.rewardKobo)}</td>
                <td>
                  <span className="icon-line" style={{ gap: '0.6rem' }}>
                    <span className="meter" aria-hidden>
                      <span style={{ width: `${share * 100}%` }} />
                    </span>
                    <span>
                      {c.used}/{c.capacity}
                      <span className="sr-only"> {kind.unit}</span>
                    </span>
                  </span>
                </td>
                <td>{shortDate(c.endsAt)}</td>
                <td>
                  <span className={chip}>{label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
