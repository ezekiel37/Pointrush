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
  })
  .strict();
export type CampaignTerms = z.infer<typeof campaignTermsSchema>;

// Prize promotions: the business distributes printed codes; Acticlaim verifies
// claims and pays the locked prize. Chance-based promotions need the business's
// own state permit, recorded here and checked in platform review.
const permitText = z.string().trim().min(1).max(160);
export const promotionTermsSchema = z
  .object({
    mode: z.enum(['every_code_wins', 'chance']),
    permit: z
      .object({ authority: permitText, number: permitText })
      .strict()
      .nullable(),
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
  .strict()
  .refine((v) => (v.mode === 'chance') === (v.permit !== null));
export type PromotionTerms = z.infer<typeof promotionTermsSchema>;
