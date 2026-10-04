'use client';
import { useState } from 'react';
import { workRequest } from '@/lib/work';
import { RequestError } from '@/lib/auth-client';
import { useSubmit } from '@/lib/use-submit';
import { decisionResult, type ReviewOption } from '@/lib/review-work';
import { EvidenceForm } from './evidence-form';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { DraftGuard } from './draft-guard';
type Prepared = {
  path: string;
  id: string;
  decision: ReviewOption['value'];
  reason: string;
  label: string;
  consequence: string;
};
export function DecisionPanel({
  path,
  options,
  onSaved,
}: {
  path: string | null;
  options: ReviewOption[];
  onSaved: () => void;
}) {
  const [reason, setReason] = useState('');
  const [choice, setChoice] = useState('');
  const [draftPath, setDraftPath] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [saved, setSaved] = useState(false);
  const submit = useSubmit((error) => {
    if (error instanceof RequestError) {
      if (error.status === 401)
        return 'Your session has ended. Sign in in another tab, then check the latest status.';
      if (error.status === 403)
        return 'Review access was denied. Check your permissions and, for appeals, verify your authenticator again.';
      if (error.status === 409)
        return 'Another decision or a changed task state prevents this action. Check the latest status.';
      if (error.status === 400)
        return 'Check the decision and enter a reason of 1–2,000 characters.';
    }
    return 'We could not confirm the outcome. Check the latest status or retry this exact decision. Do not submit a different decision while this is unresolved.';
  });
  function clear() {
    setReason('');
    setChoice('');
    setDraftPath(null);
    setPrepared(null);
    setUncertain(false);
  }
  async function confirm() {
    if (!prepared || !path || prepared.path !== path) return;
    await submit.run(async () => {
      setUncertain(true);
      try {
        await workRequest(prepared.path, decisionResult, undefined, true, {
          id: prepared.id,
          decision: prepared.decision,
          reason: prepared.reason,
        });
      } catch (error) {
        if (
          error instanceof RequestError &&
          [400, 401, 403, 404, 409, 429].includes(error.status)
        )
          setUncertain(false);
        throw error;
      }
      clear();
      setSaved(true);
      onSaved();
    });
  }
  const selected = options.find((option) => option.value === choice);
  const stale = Boolean(draftPath && path && draftPath !== path);
  return (
    <>
      <DraftGuard
        dirty={Boolean(reason || prepared)}
        busy={submit.busy}
        onDiscard={clear}
      />
      {saved && <Feedback>Decision recorded.</Feedback>}
      {submit.error && <Feedback error>{submit.error}</Feedback>}
      {path && (
        <section className="account-panel">
          <h2>Record your decision</h2>
          {stale ? (
            <>
              <Feedback error>
                A newer submission is available. Discard this draft and read the
                updated evidence before deciding.
              </Feedback>
              <Button variant="outline" onClick={clear}>
                Discard old decision draft
              </Button>
            </>
          ) : prepared ? (
            <>
              <h3>Confirm: {prepared.label}</h3>
              <p>{prepared.consequence}</p>
              <p className="work-prose">{prepared.reason}</p>
              <Button disabled={submit.busy} onClick={() => void confirm()}>
                {submit.busy
                  ? 'Recording decision…'
                  : uncertain
                    ? 'Retry same decision'
                    : 'Confirm decision'}
              </Button>
              {!uncertain && (
                <Button
                  variant="outline"
                  disabled={submit.busy}
                  onClick={() => setPrepared(null)}
                >
                  Back to editing
                </Button>
              )}
            </>
          ) : (
            <>
              <fieldset className="grid gap-3">
                <legend>Decision</legend>
                {options.map((option) => (
                  <label className="work-consent" key={option.value}>
                    <input
                      type="radio"
                      name="review-decision"
                      value={option.value}
                      checked={choice === option.value}
                      onChange={() => {
                        setChoice(option.value);
                        setDraftPath(path);
                        setSaved(false);
                      }}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </fieldset>
              {selected ? (
                <>
                  <p>{selected.consequence}</p>
                  <EvidenceForm
                    value={reason}
                    onChange={(value) => {
                      setReason(value);
                      setDraftPath(path);
                    }}
                    onSubmit={() =>
                      setPrepared({
                        path,
                        id: crypto.randomUUID(),
                        decision: selected.value,
                        reason: reason.trim(),
                        label: selected.label,
                        consequence: selected.consequence,
                      })
                    }
                    label="Review decision before confirming"
                    fieldLabel="Reason for your decision"
                    help="Explain how the evidence meets or fails the accepted task requirements."
                    limit={2000}
                    busy={submit.busy}
                    locked={false}
                  />
                </>
              ) : (
                <p>Select a decision to write your reason.</p>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
