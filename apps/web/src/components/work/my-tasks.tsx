'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useWorkRead } from '@/lib/use-work-read';
import { claimPage } from '@/lib/work';
import { backingNaira, workDate } from '@/lib/work-format';
import { Loading } from '@/components/ui/feedback';
import { WorkFrame, WorkFailure } from './work-frame';
export function MyTasks() {
  const params = useSearchParams();
  const after = params.get('after');
  const query = new URLSearchParams({ limit: '12' });
  if (after) query.set('after', after);
  const { data, error, loading, refresh } = useWorkRead(
    `claims?${query}`,
    claimPage,
  );
  return (
    <WorkFrame title="My tasks">
      <p className="work-intro">
        Your confirmed places, submissions and approved reward value.
      </p>
      {loading ? (
        <Loading>Loading your tasks…</Loading>
      ) : error ? (
        <WorkFailure error={error} retry={refresh} />
      ) : (
        data && (
          <>
            {!data.items.length ? (
              <section className="account-panel">
                <h2>No tasks on this page</h2>
                <Link className="text-link" href="/tasks">
                  Find a task
                </Link>
              </section>
            ) : (
              <ul className="work-list">
                {data.items.map((claim) => (
                  <li key={claim.id} className="account-panel">
                    <h2>
                      <Link
                        className="text-link"
                        href={`/my-tasks/${claim.id}`}
                      >
                        {claim.title}
                      </Link>
                    </h2>
                    <p>Joined {workDate(claim.joinedAt)}</p>
                    <p className="small-note">
                      First submission due before {workDate(claim.endsAt)}
                    </p>
                    <p>
                      {claim.latestProofId
                        ? 'Proof recorded'
                        : 'No proof recorded yet'}
                    </p>
                    <p>
                      <strong>{backingNaira(claim.approvedBackingKobo)}</strong>{' '}
                      approved reward value
                    </p>
                    <p className="small-note">
                      Approved value is not yet available to redeem.
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <nav aria-label="My task pages" className="flex flex-wrap gap-4">
              {after && (
                <Link className="text-link" href="/my-tasks">
                  First page
                </Link>
              )}
              {data.nextCursor && (
                <Link
                  className="text-link"
                  href={`/my-tasks?${new URLSearchParams({ after: data.nextCursor })}`}
                >
                  Next page
                </Link>
              )}
            </nav>
          </>
        )
      )}
    </WorkFrame>
  );
}
