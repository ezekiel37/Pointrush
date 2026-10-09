'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useWorkRead } from '@/lib/use-work-read';
import { sponsorTaskPage, appealQueue } from '@/lib/review-work';
import { claimPage } from '@/lib/work';
import { backingNaira, workDate } from '@/lib/work-format';
import { WorkFrame, WorkFailure } from './work-frame';
import { ReviewFrame } from '@/components/review/review-frame';
import { Loading } from '@/components/ui/feedback';
import { ReviewAccess } from './review-access';
function Pages({
  base,
  next,
  after,
}: {
  base: string;
  next: string | null;
  after: string | null;
}) {
  return (
    <nav aria-label="Review pages" className="flex flex-wrap gap-4">
      {after && (
        <Link className="text-link" href={base}>
          First page
        </Link>
      )}
      {next && (
        <Link
          className="text-link"
          href={`${base}?after=${encodeURIComponent(next)}`}
        >
          Next page
        </Link>
      )}
    </nav>
  );
}
function usePageQuery() {
  const after = useSearchParams().get('after');
  const query = new URLSearchParams({ limit: '12' });
  if (after) query.set('after', after);
  return { after, query };
}
export function SponsorTasks() {
  const { after, query } = usePageQuery();
  const read = useWorkRead(`sponsor/tasks?${query}`, sponsorTaskPage);
  return (
    <WorkFrame title="Your sponsored tasks">
      <p>Open a task to review its participants and submitted work.</p>
      {read.loading ? (
        <Loading>Loading sponsored tasks…</Loading>
      ) : read.error ? (
        <WorkFailure error={read.error} retry={read.refresh} />
      ) : (
        read.data && (
          <>
            {!read.data.items.length && <p>No sponsored tasks on this page.</p>}
            <ul className="work-list">
              {read.data.items.map((task) => (
                <li className="account-panel" key={task.id}>
                  <h2>
                    <Link
                      className="text-link"
                      href={`/sponsor/tasks/${task.id}`}
                    >
                      {task.title}
                    </Link>
                  </h2>
                  <p>{backingNaira(task.budgetKobo)} allocated budget</p>
                  <p>
                    Platform review: {task.reviewState.replaceAll('_', ' ')} ·{' '}
                    {task.lifecycle.replaceAll('_', ' ')}
                  </p>
                  <p className="small-note">Closes {workDate(task.endsAt)}</p>
                </li>
              ))}
            </ul>
            <Pages
              base="/sponsor/tasks"
              after={after}
              next={read.data.nextCursor}
            />
          </>
        )
      )}
    </WorkFrame>
  );
}
export function SponsorParticipants({ id }: { id: string }) {
  const { after, query } = usePageQuery();
  const read = useWorkRead(`tasks/${id}/claims?${query}`, claimPage);
  return (
    <WorkFrame title="Participant work">
      <Link className="back-link" href="/sponsor/tasks">
        Back to sponsored tasks
      </Link>
      {read.loading ? (
        <Loading>Loading participant work…</Loading>
      ) : read.error ? (
        <WorkFailure error={read.error} retry={read.refresh} />
      ) : (
        read.data && (
          <>
            {!read.data.items.length && <p>No participants on this page.</p>}
            <ul className="work-list">
              {read.data.items.map((claim) => (
                <li key={claim.id} className="account-panel">
                  <h2>{claim.title}</h2>
                  <p className="small-note">
                    Participation reference: {claim.id}
                  </p>
                  <p>
                    {claim.latestProofId
                      ? 'Proof submitted'
                      : 'Awaiting first proof'}
                  </p>
                  <p>
                    {backingNaira(claim.approvedBackingKobo)} approved reward
                    value
                  </p>
                  <Link
                    className="text-link"
                    href={`/sponsor/claims/${claim.id}`}
                  >
                    Review this participant’s work
                  </Link>
                </li>
              ))}
            </ul>
            <Pages
              base={`/sponsor/tasks/${id}`}
              after={after}
              next={read.data.nextCursor}
            />
          </>
        )
      )}
    </WorkFrame>
  );
}
export function AppealQueue() {
  const { after, query } = usePageQuery();
  const read = useWorkRead(`appeals?${query}`, appealQueue);
  return (
    <ReviewFrame
      title="Pending appeals"
      intro="Independent second decisions on rejected work."
    >
      <ReviewAccess />
      {read.loading ? (
        <Loading>Loading appeals…</Loading>
      ) : read.error ? (
        <WorkFailure error={read.error} retry={read.refresh} />
      ) : (
        read.data && (
          <>
            {!read.data.items.length && (
              <p>No eligible pending appeals on this page.</p>
            )}
            <ul className="work-list">
              {read.data.items.map((appeal) => (
                <li key={appeal.id} className="account-panel">
                  <h2>
                    <Link
                      className="text-link"
                      href={`/review/appeals/${appeal.id}`}
                    >
                      {appeal.title}
                    </Link>
                  </h2>
                  <p>Appealed {workDate(appeal.createdAt)}</p>
                </li>
              ))}
            </ul>
            <Pages
              base="/review/appeals"
              after={after}
              next={read.data.nextCursor}
            />
          </>
        )
      )}
    </ReviewFrame>
  );
}
