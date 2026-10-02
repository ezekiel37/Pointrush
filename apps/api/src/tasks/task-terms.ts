import { z } from 'zod';

// Explicit per-task values, reviewed with the brief; these are technical bounds,
// not default commercial terms or a promise of automatic acceptance.
export const workTermsSchema = z
  .object({
    reviewHours: z.number().int().min(1).max(720),
    correctionHours: z.number().int().min(1).max(720),
    appealHours: z.number().int().min(1).max(2160),
    settlement: z.literal('approved_reward_backing'),
  })
  .strict();
export type WorkTerms = z.infer<typeof workTermsSchema>;
