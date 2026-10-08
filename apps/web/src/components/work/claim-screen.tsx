'use client';
import Link from 'next/link';
import { useState } from 'react';
import { DraftGuard } from './draft-guard';
import { useWorkRead } from '@/lib/use-work-read';
import { useSubmit } from '@/lib/use-submit';
import { RequestError } from '@/lib/auth-client';
import {
  claimAction,
  claimView,
  proofRecord,
  receiptRecord,
  appealRecord,
} from '@/lib/claim';
import { workRequest } from '@/lib/work';
import { workDate } from '@/lib/work-format';
import { Button } from '@/components/ui/button';
import { Feedback, Loading } from '@/components/ui/feedback';
import { WorkFrame, WorkFailure } from './work-frame';
import { EvidenceForm } from './evidence-form';
import { ProofHistory } from './proof-history';

type Command = {
  kind: 'proof' | 'appeal' | 'acknowledge';
  path: string;
  body?: { id: string; revision?: number; evidence?: string; reason?: string };
};
export function ClaimScreen({ id }: { id: string }) {
  const read = useWorkRead(`claims/${id}`, claimView);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<Command | null>(null);
  const [message, setMessage] = useState('');
  const submit = useSubmit((error) => {
    if (error instanceof RequestError) {
      if (error.status === 401)
        return 'Your session has ended. Sign in in another tab, then retry. Your draft stays in this tab.';
      if (error.status === 409)
        return 'The task state or deadline has changed. Check the latest status before trying again.';
      if (error.status === 403 || error.status === 404)
        return 'This action is unavailable for your account. Check your account and the latest status.';
      if (error.status === 400)
        return 'The submission could not be accepted. Check the text and try again.';
    }
    return 'We could not confirm the outcome. Your submission is held unchanged. Check the latest status or retry the same submission.';
  });
  const action = read.data
    ? claimAction(read.data, Date.parse(read.data.observedAt))
    : null;
  async function send() {
    await submit.run(async () => {
      let command = pending;
      if (!command) {
        if (action?.kind === 'proof')
          command = {
            kind: 'proof',
            path: `claims/${id}/proofs`,
            body: {
              id: crypto.randomUUID(),
              revision: action.revision,
              evidence: draft.trim(),
            },
          };
        else if (action?.kind === 'appeal')
          command = {
            kind: 'appeal',
            path: `proofs/${action.proofId}/appeals`,
            body: { id: crypto.randomUUID(), reason: draft.trim() },
          };
        else if (action?.kind === 'acknowledge')
          command = {
            kind: 'acknowledge',
            path: `proofs/${action.proofId}/acknowledgements`,
          };
        else return;
        setPending(command);
      }
      try {
        if (command.kind === 'proof')
          await workRequest(
            command.path,
            proofRecord,
            undefined,
            true,
            command.body,
          );
        else if (command.kind === 'appeal')
          await workRequest(
            command.path,
            appealRecord,
            undefined,
            true,
            command.body,
          );
        else await workRequest(command.path, receiptRecord, undefined, true);
      } catch (error) {
        if (
          error instanceof RequestError &&
          [400, 401, 403, 404, 409, 429].includes(error.status)
        )
          setPending(null);
        throw error;
      }
      setDraft('');
      setPending(null);
      setMessage(
        command.kind === 'acknowledge'
          ? 'Decision acknowledged. Your response window has started.'
          : 'Submission recorded. Check its status below.',
      );
      read.refresh();
    });
  }
  return (
    <WorkFrame title={read.data?.task.title ?? 'Your task'}>
      <Link className="text-link" href="/my-tasks">
        Back to My tasks
      </Link>
      <DraftGuard
        dirty={Boolean(draft || pending)}
        busy={submit.busy}
        onDiscard={() => {
          setDraft('');
          setPending(null);
        }}
      />
      {message && <Feedback>{message}</Feedback>}
      {submit.error && (
        <Feedback error>
          {submit.error}{' '}
          <Link
            className="text-link"
            href="/login"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open sign in
          </Link>
        </Feedback>
      )}
      <Button
        variant="outline"
        disabled={read.loading}
        loading={submit.busy}
        onClick={read.refresh}
      >
        Check latest status
      </Button>
      {read.loading ? (
        <Loading>Loading your submission…</Loading>
      ) : read.error ? (
        <WorkFailure error={read.error} retry={read.refresh} />
      ) : (
        read.data && (
          <>
            <section className="account-panel">
              <h2>Your brief</h2>
              <p className="work-prose">{read.data.task.instructions}</p>
              <h3>Required proof</h3>
              <p className="work-prose">{read.data.task.proofRequirements}</p>
              <h3>Rejection conditions</h3>
              <p className="work-prose">{read.data.task.rejectionCriteria}</p>
              <p>
                First submission deadline: {workDate(read.data.task.endsAt)}
              </p>
              <p className="small-note">
                Review target: {read.data.task.workTerms.reviewHours} hours.
                Approval is not automatic. Approved reward value is not yet
                available to redeem.
              </p>
            </section>
            <ProofHistory proofs={read.data.proofs} />
            {action?.kind === 'closed' && (
              <Feedback>
                The response window has ended. The server checks deadlines when
                you submit.
              </Feedback>
            )}
            {(action?.kind === 'acknowledge' ||
              pending?.kind === 'acknowledge') && (
              <section className="account-panel">
                <h2>Acknowledge this decision</h2>
                <p>
                  This records that you received the decision and starts the
                  applicable response window:{' '}
                  {read.data.task.workTerms.correctionHours} hours for a
                  correction, or {read.data.task.workTerms.appealHours} hours
                  for an appeal. Acknowledging does not mean you agree with it.
                </p>
                <Button loading={submit.busy} onClick={() => void send()}>
                  Acknowledge decision and start response window
                </Button>
              </section>
            )}
            {(action?.kind === 'proof' ||
              action?.kind === 'appeal' ||
              pending?.kind === 'proof' ||
              pending?.kind === 'appeal') && (
              <section className="account-panel">
                <h2>Your response</h2>
                {action?.deadline && (
                  <p>Submit before {workDate(action.deadline)}</p>
                )}
                <EvidenceForm
                  value={draft}
                  onChange={setDraft}
                  onSubmit={() => void send()}
                  label={
                    (pending?.kind ?? action?.kind) === 'appeal'
                      ? 'Submit appeal'
                      : 'Submit proof'
                  }
                  limit={
                    (pending?.kind ?? action?.kind) === 'appeal' ? 2000 : 10000
                  }
                  busy={submit.busy}
                  locked={Boolean(pending)}
                />
              </section>
            )}
          </>
        )
      )}
    </WorkFrame>
  );
}
