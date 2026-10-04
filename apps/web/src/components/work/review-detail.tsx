'use client';
import Link from 'next/link';
import { claimView } from '@/lib/claim';
import { appealView, sponsorOptions, approve, uphold } from '@/lib/review-work';
import { useWorkRead } from '@/lib/use-work-read';
import { WorkFrame, WorkFailure } from './work-frame';
import { Feedback, Loading } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { ProofHistory } from './proof-history';
import { DecisionPanel } from './decision-panel';
import { ReviewAccess } from './review-access';
function Brief({
  task,
}: {
  task: {
    instructions: string;
    proofRequirements: string;
    rejectionCriteria: string;
  };
}) {
  return (
    <section className="account-panel">
      <h2>Accepted task requirements</h2>
      <p className="work-prose">{task.instructions}</p>
      <h3>Required proof</h3>
      <p className="work-prose">{task.proofRequirements}</p>
      <h3>Rejection conditions</h3>
      <p className="work-prose">{task.rejectionCriteria}</p>
    </section>
  );
}
export function SponsorReview({ id }: { id: string }) {
  const read = useWorkRead(`claims/${id}`, claimView);
  const latest = read.data?.proofs
    .slice()
    .sort((a, b) => a.proof.revision - b.proof.revision)
    .at(-1);
  const allowed = read.data && !read.data.participant;
  const path =
    allowed && latest && !latest.decision
      ? `proofs/${latest.proof.id}/decisions`
      : null;
  return (
    <WorkFrame title={read.data?.task.title ?? 'Review submitted work'}>
      <Link className="text-link" href="/sponsor/tasks">
        Back to sponsored tasks
      </Link>
      <Button variant="outline" disabled={read.loading} onClick={read.refresh}>
        Check latest status
      </Button>
      {read.loading ? (
        <Loading>Loading work for review…</Loading>
      ) : read.error ? (
        <WorkFailure error={read.error} retry={read.refresh} />
      ) : (
        read.data && (
          <>
            {!allowed ? (
              <Feedback error>
                This is your own participation. Sponsor decisions are
                unavailable.
              </Feedback>
            ) : (
              <>
                <Brief task={read.data.task} />
                <ProofHistory proofs={read.data.proofs} />
                {!path && <p>No submission is awaiting your decision.</p>}
              </>
            )}
          </>
        )
      )}
      <DecisionPanel
        path={path}
        options={sponsorOptions(latest?.proof.revision ?? 2)}
        onSaved={read.refresh}
      />
    </WorkFrame>
  );
}
export function AppealReview({ id }: { id: string }) {
  const read = useWorkRead(`appeals/${id}`, appealView);
  const path =
    read.data && !read.data.resolution ? `appeals/${id}/resolutions` : null;
  return (
    <WorkFrame title={read.data?.task.title ?? 'Review appeal'}>
      <Link className="text-link" href="/review/appeals">
        Back to pending appeals
      </Link>
      <ReviewAccess />
      <Button variant="outline" disabled={read.loading} onClick={read.refresh}>
        Check latest status
      </Button>
      {read.loading ? (
        <Loading>Loading appeal evidence…</Loading>
      ) : read.error ? (
        <WorkFailure error={read.error} retry={read.refresh} />
      ) : (
        read.data && (
          <>
            <Brief task={read.data.task} />
            <section className="account-panel">
              <h2>Participant’s appeal</h2>
              <p className="work-prose">{read.data.appeal.reason}</p>
            </section>
            <ProofHistory
              proofs={read.data.history.map((row) => ({
                ...row,
                receipt: null,
                appeal: null,
                resolution: null,
              }))}
            />
            {read.data.resolution && (
              <section className="account-panel">
                <h2>
                  {read.data.resolution.decision === 'approved'
                    ? 'Appeal approved'
                    : 'Rejection upheld'}
                </h2>
                <p className="work-prose">{read.data.resolution.reason}</p>
              </section>
            )}
          </>
        )
      )}
      <DecisionPanel
        path={path}
        options={[approve, uphold]}
        onSaved={read.refresh}
      />
    </WorkFrame>
  );
}
