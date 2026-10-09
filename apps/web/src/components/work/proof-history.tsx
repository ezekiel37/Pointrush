import { FileText } from 'lucide-react';
import type { ClaimView } from '@/lib/claim';
import { privateFileUrl } from '@/lib/files';
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
      {proofs.map(
        ({ proof, decision, receipt, appeal, resolution, files = [] }) => (
          <article key={proof.id} className="grid gap-3">
            <h3>{proof.revision === 1 ? 'First submission' : 'Correction'}</h3>
            <p className="small-note">Submitted {workDate(proof.createdAt)}</p>
            <p className="work-prose">{proof.evidence}</p>
            {files.length > 0 && (
              <ul className="evidence-files" aria-label="Attached files">
                {files.map((f, i) => (
                  <li key={f.id}>
                    {f.removed ? (
                      <span className="small-note">
                        File {i + 1} removed after the keeping time
                      </span>
                    ) : f.contentType === 'application/pdf' ? (
                      <a
                        className="button button-outline"
                        href={privateFileUrl(f.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <FileText size={16} aria-hidden /> PDF {i + 1}
                      </a>
                    ) : (
                      <a
                        href={privateFileUrl(f.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={privateFileUrl(f.id)}
                          alt={`Photo ${i + 1} of the proof`}
                        />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
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
        ),
      )}
    </section>
  );
}
