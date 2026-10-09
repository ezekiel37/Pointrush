import { z } from 'zod';
const timestamp = z.iso.datetime({ offset: true });
export const proofRecord = z.object({
  id: z.uuid(),
  claimId: z.uuid(),
  revision: z.number().int().min(1).max(2),
  evidence: z.string(),
  createdAt: timestamp,
});
export const receiptRecord = z.object({
  proofId: z.uuid(),
  createdAt: timestamp,
});
export const appealRecord = z.object({
  id: z.uuid(),
  proofId: z.uuid(),
  reason: z.string(),
  createdAt: timestamp,
});
// Photos or PDFs attached to a proof; removed ones were past keeping time.
export const proofFiles = z
  .array(
    z.object({ id: z.uuid(), contentType: z.string(), removed: z.boolean() }),
  )
  .default([]);
export const claimView = z.object({
  participant: z.boolean(),
  observedAt: timestamp,
  claim: z.object({
    id: z.uuid(),
    taskId: z.uuid(),
    accountId: z.uuid(),
    createdAt: timestamp,
  }),
  task: z.object({
    title: z.string(),
    instructions: z.string(),
    proofRequirements: z.string(),
    rejectionCriteria: z.string(),
    endsAt: timestamp,
    workTerms: z.object({
      reviewHours: z.number(),
      correctionHours: z.number(),
      appealHours: z.number(),
    }),
  }),
  proofs: z.array(
    z.object({
      proof: proofRecord,
      decision: z
        .object({
          decision: z.enum(['approved', 'changes_required', 'rejected']),
          reason: z.string(),
          createdAt: timestamp,
        })
        .nullable(),
      receipt: receiptRecord.nullable(),
      appeal: appealRecord.nullable(),
      resolution: z
        .object({
          decision: z.enum(['approved', 'upheld']),
          reason: z.string(),
          createdAt: timestamp,
        })
        .nullable(),
      files: proofFiles,
    }),
  ),
});
export type ClaimView = z.infer<typeof claimView>;
export function claimAction(data: ClaimView, now: number) {
  if (!data.participant) return { kind: 'none' as const };
  const latest = [...data.proofs]
    .sort((a, b) => a.proof.revision - b.proof.revision)
    .at(-1);
  if (!latest)
    return now < Date.parse(data.task.endsAt)
      ? { kind: 'proof' as const, revision: 1, deadline: data.task.endsAt }
      : { kind: 'closed' as const };
  const decision = latest.decision?.decision;
  if (!decision || decision === 'approved' || latest.appeal)
    return { kind: 'none' as const };
  if (!latest.receipt)
    return { kind: 'acknowledge' as const, proofId: latest.proof.id };
  const hours =
    decision === 'changes_required'
      ? data.task.workTerms.correctionHours
      : data.task.workTerms.appealHours;
  const deadline = new Date(
    Date.parse(latest.receipt.createdAt) + hours * 3600000,
  ).toISOString();
  if (now >= Date.parse(deadline)) return { kind: 'closed' as const };
  if (decision === 'changes_required' && latest.proof.revision === 1)
    return { kind: 'proof' as const, revision: 2, deadline };
  if (decision === 'rejected')
    return { kind: 'appeal' as const, proofId: latest.proof.id, deadline };
  return { kind: 'none' as const };
}
