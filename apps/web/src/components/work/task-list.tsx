'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useWorkRead } from '@/lib/use-work-read';
import { taskPage } from '@/lib/work';
import { backingNaira, workDate } from '@/lib/work-format';
import { Loading } from '@/components/ui/feedback';
import { WorkFrame, WorkFailure } from './work-frame';
import { TaskSearch } from './task-search';
export function TaskList() {
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const after = params.get('after');
  const query = new URLSearchParams({ limit: '12' });
  if (q) query.set('q', q);
  if (after) query.set('after', after);
  const { data, error, loading, refresh } = useWorkRead(
    `tasks?${query}`,
    taskPage,
  );
  const next = new URLSearchParams();
  if (q) next.set('q', q);
  if (data?.nextCursor) next.set('after', data.nextCursor);
  return (
    <WorkFrame title="Find your next task">
      <p className="work-intro">
        Read the brief, check the deadline and decide what you can deliver.
        Rewards depend on approved work.
      </p>
      <TaskSearch query={q} />
      {loading ? (
        <Loading>Loading tasks…</Loading>
      ) : error ? (
        <WorkFailure error={error} retry={refresh} />
      ) : (
        data && (
          <>
            <p role="status" className="small-note">
              {data.items.length} {data.items.length === 1 ? 'task' : 'tasks'}{' '}
              on this page
            </p>
            {data.items.length === 0 ? (
              <section className="account-panel">
                <h2>{q ? 'No matching tasks' : 'No tasks here yet'}</h2>
                <p>
                  {q
                    ? 'Try another title or clear your search.'
                    : 'Check again later for published opportunities.'}
                </p>
              </section>
            ) : (
              <ul className="work-list">
                {data.items.map((task) => (
                  <li className="account-panel" key={task.id}>
                    <p className="eyebrow">{task.businessName}</p>
                    <h2>
                      <Link className="text-link" href={`/tasks/${task.id}`}>
                        {task.title}
                      </Link>
                    </h2>
                    <p>
                      <strong>{backingNaira(task.rewardBackingKobo)}</strong>{' '}
                      reward value after approval
                    </p>
                    <p className="small-note">
                      Opens {workDate(task.startsAt)} · Closes{' '}
                      {workDate(task.endsAt)}
                    </p>
                    <p className="small-note">
                      {task.claimed} of {task.capacity} places claimed
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <nav aria-label="Task pages" className="flex flex-wrap gap-4">
              {after && (
                <Link
                  className="text-link"
                  href={q ? `/tasks?${new URLSearchParams({ q })}` : '/tasks'}
                >
                  First page
                </Link>
              )}
              {data.nextCursor && (
                <Link className="text-link" href={`/tasks?${next}`}>
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
