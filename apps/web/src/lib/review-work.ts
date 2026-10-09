import { z } from 'zod';
import { claimView, appealRecord, proofRecord } from './claim';
export const sponsorTaskPage = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      reviewState: z.string(),
      lifecycle: z.string(),
      endsAt: z.iso.datetime({ offset: true }),
      budgetKobo: z.string().regex(/^\d+$/),
    }),
  ),
  nextCursor: z.uuid().nullable(),
});
export const appealQueue = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      taskId: z.uuid(),
      createdAt: z.iso.datetime({ offset: true }),
    }),
  ),
  nextCursor: z.uuid().nullable(),
});
export const decisionResult = z.object({
  id: z.uuid(),
  decision: z.enum(['approved', 'changes_required', 'rejected', 'upheld']),
  reason: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
});
export const appealView = z.object({
  appeal: appealRecord,
  claim: claimView.shape.claim,
  task: claimView.shape.task,
  history: z.array(
    z.object({
      proof: proofRecord,
      decision: claimView.shape.proofs.element.shape.decision,
      files: claimView.shape.proofs.element.shape.files,
    }),
  ),
  resolution: decisionResult.nullable(),
});
export type ReviewOption = {
  value: 'approved' | 'changes_required' | 'rejected' | 'upheld';
  label: string;
  consequence: string;
};
export const approve: ReviewOption = {
  value: 'approved',
  label: 'Approve work',
  consequence:
    'This records approval and credits the funded reward value once. This decision cannot be edited here.',
};
export const correct: ReviewOption = {
  value: 'changes_required',
  label: 'Request one correction',
  consequence:
    'The participant may submit one correction after acknowledging this decision.',
};
export const reject: ReviewOption = {
  value: 'rejected',
  label: 'Reject work',
  consequence:
    'The participant can appeal after acknowledging this decision. The task allocation remains locked.',
};
export const uphold: ReviewOption = {
  value: 'upheld',
  label: 'Uphold rejection',
  consequence:
    'This closes the appeal with the rejection upheld. It does not release or refund the task allocation.',
};
export function sponsorOptions(revision: number): ReviewOption[] {
  return revision === 1 ? [approve, correct, reject] : [approve, reject];
}
