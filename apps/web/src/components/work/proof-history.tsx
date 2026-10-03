import type { ClaimView } from '@/lib/claim';
import { workDate } from '@/lib/work-format';
const labels = {
  approved: 'Approved',
  changes_required: 'Correction requested',
  rejected: 'Rejected',
};
export function ProofHistory({ proofs }: { proofs: ClaimView['proofs'] }) {
  return (
    <section className="account-panel">
      <h2>Submission history</h2>
      {!proofs.length && <p>No proof submitted yet.</p>}
      {proofs.map(({ proof, decision, receipt, appeal, resolution }) => (
        <article key={proof.id} className="grid gap-3">
          <h3>{proof.revision === 1 ? 'First submission' : 'Correction'}</h3>
          <p className="small-note">Submitted {workDate(proof.createdAt)}</p>
          <p className="work-prose">{proof.evidence}</p>
          <strong>
            {decision ? labels[decision.decision] : 'Awaiting sponsor review'}
          </strong>
          {decision && <p className="work-prose">{decision.reason}</p>}
          {receipt && (
            <p className="small-note">
              Decision acknowledged {workDate(receipt.createdAt)}
            </p>
          )}
          {appeal && (
            <>
              <h3>Appeal</h3>
              <p className="work-prose">{appeal.reason}</p>
              <p>
                {resolution
                  ? resolution.decision === 'approved'
                    ? 'Appeal approved'
                    : 'Original rejection upheld'
                  : 'Awaiting independent review'}
              </p>
            </>
          )}
          {resolution && <p className="work-prose">{resolution.reason}</p>}
        </article>
      ))}
    </section>
  );
}
