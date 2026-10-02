'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useWorkRead } from '@/lib/use-work-read';
import { useSubmit } from '@/lib/use-submit';
import { claimResult, taskDetail, workRequest, workError } from '@/lib/work';
import { backingNaira, workDate } from '@/lib/work-format';
import { Button } from '@/components/ui/button';
import { Feedback, Loading } from '@/components/ui/feedback';
import { WorkFrame, WorkFailure } from './work-frame';
export function TaskDetail({ id }: { id: string }) {
  const { data, error, loading, refresh } = useWorkRead(
    `tasks/${encodeURIComponent(id)}`,
    taskDetail,
  );
  const [accepted, setAccepted] = useState(false);
  const [joined, setJoined] = useState(false);
  const submit = useSubmit(workError);
  const join = () =>
    submit.run(async () => {
      await workRequest(
        `tasks/${encodeURIComponent(id)}/join`,
        claimResult,
        undefined,
        true,
      );
      setJoined(true);
      refresh();
    });
  return (
    <WorkFrame title={data?.title ?? 'Task details'}>
      <Link className="text-link" href="/tasks">
        Back to tasks
      </Link>
      {loading ? (
        <Loading>Loading the brief…</Loading>
      ) : error ? (
        <WorkFailure error={error} retry={refresh} />
      ) : (
        data && (
          <>
            <section className="account-panel">
              <p className="eyebrow">Reward after approval</p>
              <h2>{backingNaira(data.rewardBackingKobo)}</h2>
              <p>
                This is the value set aside for approved work. Cash withdrawal
                and reward redemption are not available in this version.
              </p>
              <dl className="work-facts">
                <div>
                  <dt>Opens</dt>
                  <dd>{workDate(data.startsAt)}</dd>
                </div>
                <div>
                  <dt>Complete before</dt>
                  <dd>{workDate(data.endsAt)}</dd>
                </div>
                <div>
                  <dt>Places claimed</dt>
                  <dd>
                    {data.claimed} of {data.capacity}
                  </dd>
                </div>
              </dl>
            </section>
            <section className="account-panel">
              <h2>What to do</h2>
              <p className="work-prose">{data.instructions}</p>
              <h2>What to submit</h2>
              <p className="work-prose">{data.proofRequirements}</p>
              <h2>Why work may be rejected</h2>
              <p className="work-prose">{data.rejectionCriteria}</p>
            </section>
            <section className="account-panel">
              <h2>Review and your right to appeal</h2>
              <p>
                The sponsor aims to review within {data.workTerms.reviewHours}{' '}
                hours. A delayed review does not automatically approve or reject
                your work.
              </p>
              <p>
                If a correction is requested, you have one opportunity to
                resubmit within {data.workTerms.correctionHours} hours of
                acknowledging the decision. You can appeal a rejection within{' '}
                {data.workTerms.appealHours} hours of acknowledging it.
              </p>
              <p className="small-note">
                Task terms version {data.termsVersion}. Places are confirmed by
                the server when you join.
              </p>
            </section>
            {joined ? (
              <Feedback>
                Your place is confirmed. You can find it in{' '}
                <Link className="text-link" href="/my-tasks">
                  My tasks
                </Link>
                .
              </Feedback>
            ) : (
              <section className="account-panel">
                <h2>Ready to take part?</h2>
                <label className="work-consent">
                  <input
                    type="checkbox"
                    checked={accepted}
                    disabled={submit.busy}
                    onChange={(e) => setAccepted(e.target.checked)}
                  />
                  <span>
                    I have read the brief, deadline, proof requirements and
                    review rules.
                  </span>
                </label>
                <Button
                  disabled={!accepted || submit.busy}
                  onClick={() => void join()}
                >
                  {submit.busy ? 'Confirming your place…' : 'Join task'}
                </Button>
                <p className="small-note">
                  Already joined? This action returns your existing place
                  without reserving another.
                </p>
                {submit.error && (
                  <Feedback error>
                    {submit.error}{' '}
                    <Link className="text-link" href="/my-tasks">
                      Check My tasks
                    </Link>{' '}
                    before retrying.
                  </Feedback>
                )}
              </section>
            )}
          </>
        )
      )}
    </WorkFrame>
  );
}
