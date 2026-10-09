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

// Reviewed with the campaign. Hold covers the business's refund window.
export const campaignTermsSchema = z
  .object({
    minSpendKobo: z
      .string()
      .regex(/^(0|[1-9][0-9]{0,14})$/)
      .refine((v) => BigInt(v) <= 100000000000000n),
    holdHours: z.number().int().min(24).max(720),
    placeName: z.string().trim().min(1).max(160),
    placeAddress: z.string().trim().min(1).max(300),
    // Omitted: one cash back per shopper. 'monthly': one per shopper per
    // Lagos calendar month, so the business can see who keeps coming back.
    repeat: z.literal('monthly').optional(),
    // Group offer: everyone gets the full cash back once `target` people have
    // bought, or `baseKobo` each if the target is not reached by the end.
    group: z
      .object({
        target: z.number().int().min(2).max(100000),
        // Always paid, so nobody who bought leaves with nothing.
        baseKobo: z.string().regex(/^[1-9][0-9]{0,14}$/),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((t) => !(t.group && t.repeat));
export type CampaignTerms = z.infer<typeof campaignTermsSchema>;

// Prize promotions: the business creates codes on Acticlaim and funds every
// one; each funded code wins its prize. Acticlaim does not run draws or games
// of chance. If a business mixes in losing papers offline, that is its own
// promotion and its own permit.
export const promotionTermsSchema = z
  .object({
    mode: z.literal('every_code_wins'),
    permit: z.null(),
    claimLimitPerPerson: z.number().int().min(1).max(20),
    howToGetCodes: z.string().trim().min(1).max(300),
    // A physical prize. Its cash value is still locked as the reward: it
    // returns to the business on handover, or pays the winner if the business
    // does not hand it over within 14 days.
    prize: z
      .object({ item: z.string().trim().min(1).max(160) })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
export type PromotionTerms = z.infer<typeof promotionTermsSchema>;
