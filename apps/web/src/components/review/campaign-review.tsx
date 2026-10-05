'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { z } from 'zod';
import { ReviewFrame } from './review-frame';
import { Button } from '@/components/ui/button';
import { Feedback, Loading } from '@/components/ui/feedback';
import { WorkFailure } from '@/components/work/work-frame';
import { ReviewAccess } from '@/components/work/review-access';
import { apiRequest, money, naira, newId, shortDate } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { useApiRead } from '@/lib/use-api-read';

const date = z.iso.datetime({ offset: true });
const pending = z.object({
  id: z.uuid(),
  sponsorName: z.string(),
  title: z.string(),
  instructions: z.string(),
  proofRequirements: z.string(),
  rejectionCriteria: z.string(),
  model: z.string(),
  capacity: z.number().int(),
  rewardKobo: money,
  budgetKobo: money,
  startsAt: date,
  endsAt: date,
  termsVersion: z.number().int(),
  termsHash: z.string(),
  // Large campaigns: set once the first of two reviewers has approved.
  firstApprovedBy: z.string().nullable().default(null),
  campaignTerms: z
    .object({
      minSpendKobo: money,
      holdHours: z.number(),
      placeName: z.string(),
      placeAddress: z.string(),
    })
    .nullable(),
  promotionTerms: z
    .object({
      mode: z.enum(['every_code_wins', 'chance']),
      permit: z
        .object({ authority: z.string(), number: z.string() })
        .nullable(),
      claimLimitPerPerson: z.number().int(),
      howToGetCodes: z.string(),
    })
    .nullable(),
});
const queue = z.object({
  items: z.array(pending),
  nextCursor: z.uuid().nullable(),
});
type Pending = z.infer<typeof pending>;

// Campaigns locking ₦1,000,000 or more need two different reviewers.
const twoReviewerKobo = 100000000n;
const needsTwo = (task: Pending) => BigInt(task.budgetKobo) >= twoReviewerKobo;

const kind: Record<string, string> = {
  purchase_cashback: 'Cash back',
  claim_code: 'Prize promotion',
};
const checks = [
  ['permittedObjective', 'Lawful and allowed on Acticlaim'],
  ['clearInstructions', 'Instructions are clear to an ordinary customer'],
  ['feasibleProof', 'The proof can really be checked (till, code or work)'],
  ['fairRewardTerms', 'Reward, hold and limits are fair and as advertised'],
  ['safeDestinations', 'No unsafe links, places or personal data requests'],
] as const;
type Check = (typeof checks)[number][0];

function accessError(error: unknown) {
  return (
    error instanceof RequestError &&
    (error.status === 403 || error.status === 401)
  );
}

export function CampaignQueue() {
  const params = useSearchParams();
  const read = useApiRead('admin/reviews/tasks?limit=50', queue);
  return (
    <ReviewFrame
      title="Campaigns to review"
      intro="Nothing goes live until it passes here. Money is already locked for every item."
    >
      <div className="grid gap-4" style={{ marginTop: '1rem' }}>
        {params.get('decided') === 'first' ? (
          <Feedback>
            First approval recorded. A second reviewer must approve before the
            campaign can go live.
          </Feedback>
        ) : (
          params.get('decided') && <Feedback>Decision recorded.</Feedback>
        )}
        {read.loading && !read.data ? (
          <Loading>Loading campaigns…</Loading>
        ) : read.error && accessError(read.error) ? (
          <ReviewAccess />
        ) : read.error ? (
          <WorkFailure error={read.error} retry={read.refresh} />
        ) : read.data?.items.length ? (
          <ul className="stack">
            {read.data.items.map((item) => (
              <li
                key={item.id}
                className="card row"
                style={{ flexWrap: 'wrap' }}
              >
                <div style={{ minWidth: 0, flex: '1 1 14rem' }}>
                  <Link
                    className="text-link"
                    href={`/review/campaigns/${item.id}`}
                    style={{ fontWeight: 600 }}
                  >
                    {item.title}
                  </Link>
                  <p className="small-note">
                    {item.sponsorName} · {kind[item.model] ?? 'Job'} · starts{' '}
                    {shortDate(item.startsAt)}
                  </p>
                </div>
                {item.firstApprovedBy && (
                  <span className="chip chip-pending">Needs 2nd approval</span>
                )}
                <span className="amount">{naira(item.budgetKobo)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small-note">Nothing waiting for review.</p>
        )}
      </div>
    </ReviewFrame>
  );
}

function Terms({ task }: { task: Pending }) {
  const rows: [string, string][] = [
    ['Business', task.sponsorName],
    ['Type', kind[task.model] ?? 'Job'],
    [
      'Money',
      `${naira(task.rewardKobo)} × ${task.capacity.toLocaleString('en-NG')} = ${naira(task.budgetKobo)} locked`,
    ],
    ['Runs', `${shortDate(task.startsAt)} to ${shortDate(task.endsAt)}`],
  ];
  if (task.campaignTerms)
    rows.push(
      [
        'Place',
        `${task.campaignTerms.placeName}, ${task.campaignTerms.placeAddress}`,
      ],
      [
        'Minimum spend',
        task.campaignTerms.minSpendKobo === '0'
          ? 'Any purchase'
          : naira(task.campaignTerms.minSpendKobo),
      ],
      ['Refund hold', `${task.campaignTerms.holdHours} hours`],
    );
  if (task.promotionTerms)
    rows.push(
      [
        'Who wins',
        task.promotionTerms.mode === 'chance'
          ? 'Some codes win (chance)'
          : 'Every code wins',
      ],
      [
        'Permit',
        task.promotionTerms.permit
          ? `${task.promotionTerms.permit.authority}, no. ${task.promotionTerms.permit.number}`
          : 'Not needed',
      ],
      ['Prizes per person', String(task.promotionTerms.claimLimitPerPerson)],
      ['Codes found', task.promotionTerms.howToGetCodes],
    );
  rows.push(
    ['What people do', task.instructions],
    ['Proof', task.proofRequirements],
    ['Rejected or voided when', task.rejectionCriteria],
  );
  return (
    <dl className="terms-list">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function decisionError(error: unknown) {
  if (accessError(error))
    return 'Your review access or authenticator check has expired. Verify again, then submit.';
  if (
    error instanceof RequestError &&
    error.code === 'second_reviewer_required'
  )
    return 'You gave the first approval. A different reviewer must give the second.';
  if (error instanceof RequestError && error.status === 409)
    return 'This campaign changed or was already decided. Go back to the list.';
  return 'We could not record the decision. Check your connection and submit again; it is recorded once.';
}

export function CampaignReview({ id }: { id: string }) {
  const router = useRouter();
  const read = useApiRead(`admin/reviews/tasks/${id}`, pending);
  const [checked, setChecked] = useState<Record<Check, boolean>>({
    permittedObjective: false,
    clearInstructions: false,
    feasibleProof: false,
    fairRewardTerms: false,
    safeDestinations: false,
  });
  const [decision, setDecision] = useState<
    'approved' | 'changes_required' | 'rejected'
  >('approved');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const allChecked = Object.values(checked).every(Boolean);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const task = read.data;
    if (!task || busy) return;
    if (!reason.trim()) {
      setError(
        decision === 'approved'
          ? 'Note what you checked, for the audit record.'
          : 'Tell the business what to change or why it was rejected.',
      );
      return;
    }
    if (decision === 'approved' && !allChecked) {
      setError('Approval needs every check confirmed.');
      return;
    }
    const body = {
      termsVersion: task.termsVersion,
      termsHash: task.termsHash,
      decision,
      reason: reason.trim(),
      checklist: checked,
    };
    const key = JSON.stringify(body);
    if (attempt.current?.key !== key) attempt.current = { key, id: newId() };
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest(
        `admin/reviews/tasks/${id}/decision`,
        z.object({ awaitingSecondReviewer: z.boolean().optional() }),
        {
          method: 'POST',
          body: { requestId: attempt.current.id, ...body },
        },
      );
      router.push(
        result.awaitingSecondReviewer
          ? '/review/campaigns?decided=first'
          : '/review/campaigns?decided=1',
      );
    } catch (cause) {
      if (cause instanceof RequestError && cause.status < 500)
        attempt.current = null;
      setError(decisionError(cause));
      setBusy(false);
    }
  }

  return (
    <ReviewFrame
      title={read.data?.title ?? 'Campaign review'}
      section={{ label: 'Campaigns', href: '/review/campaigns' }}
    >
      {read.loading && !read.data ? (
        <Loading>Loading campaign…</Loading>
      ) : read.error && accessError(read.error) ? (
        <ReviewAccess />
      ) : read.error ? (
        <WorkFailure error={read.error} retry={read.refresh} />
      ) : (
        read.data && (
          <div className="grid gap-4" style={{ marginTop: '1rem' }}>
            <section className="card">
              <Terms task={read.data} />
            </section>
            {needsTwo(read.data) && (
              <Feedback>
                {read.data.firstApprovedBy
                  ? 'One reviewer has approved. Your approval would be the second and makes the campaign ready to go live.'
                  : 'This campaign locks ₦1,000,000 or more, so two different reviewers must approve it. Yours would be the first.'}
              </Feedback>
            )}
            <form className="card grid gap-4" onSubmit={submit} noValidate>
              <fieldset className="form-section">
                <legend>Checks</legend>
                {checks.map(([key, label]) => (
                  <label key={key} className="work-consent">
                    <input
                      type="checkbox"
                      checked={checked[key]}
                      onChange={(e) =>
                        setChecked((c) => ({ ...c, [key]: e.target.checked }))
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="form-section">
                <legend>Decision</legend>
                <div
                  className="segmented preset-row three"
                  role="group"
                  aria-label="Decision"
                >
                  {(
                    [
                      ['approved', 'Approve'],
                      ['changes_required', 'Ask for changes'],
                      ['rejected', 'Reject'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={decision === value}
                      onClick={() => setDecision(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="field">
                  <label htmlFor="review-reason">
                    {decision === 'approved'
                      ? 'What you checked'
                      : 'Message to the business'}
                  </label>
                  <textarea
                    id="review-reason"
                    className="input textarea"
                    rows={3}
                    maxLength={2000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
              </fieldset>
              {error && <Feedback error>{error}</Feedback>}
              <Button
                type="submit"
                variant={decision === 'approved' ? 'accent' : 'default'}
                disabled={busy || (decision === 'approved' && !allChecked)}
              >
                {busy
                  ? 'Recording…'
                  : decision === 'approved'
                    ? 'Approve campaign'
                    : decision === 'changes_required'
                      ? 'Send back for changes'
                      : 'Reject campaign'}
              </Button>
            </form>
          </div>
        )
      )}
    </ReviewFrame>
  );
}
