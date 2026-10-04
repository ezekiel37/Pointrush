import { z } from 'zod';
import { money } from './api';

const date = z.iso.datetime({ offset: true });
const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.uuid().nullable() });

export const claimResult = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  title: z.string(),
  businessName: z.string(),
  prizeKobo: money,
  claimedAt: date,
});
export const claimList = page(claimResult);

export const campaignTerms = z.object({
  minSpendKobo: money,
  holdHours: z.number(),
  placeName: z.string(),
  placeAddress: z.string(),
});
export const offerSummary = z.object({
  id: z.uuid(),
  title: z.string(),
  businessName: z.string(),
  startsAt: date,
  endsAt: date,
  capacity: z.number().int(),
  claimed: z.number().int(),
  rewardBackingKobo: money,
  model: z.string(),
  campaignTerms: campaignTerms.nullable(),
});
export const offerPage = page(offerSummary);
export const offerDetail = z.object({
  id: z.uuid(),
  title: z.string(),
  instructions: z.string(),
  startsAt: date,
  endsAt: date,
  capacity: z.number().int(),
  claimed: z.number().int(),
  rewardBackingKobo: money,
  model: z.string(),
  campaignTerms: campaignTerms.nullable(),
});

export const purchaseCode = z.object({
  taskId: z.uuid(),
  code: z.string(),
  display: z.string(),
  expiresAt: date,
});

const purchaseState = z.enum(['pending', 'releasable', 'released', 'voided']);
export const purchase = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  title: z.string(),
  businessName: z.string(),
  amountKobo: money,
  cashbackKobo: money,
  releaseAt: date,
  createdAt: date,
  state: purchaseState,
});
export const purchasePage = page(purchase).extend({ observedAt: date });

export const tier = z.object({
  name: z.enum(['New', 'Bronze', 'Silver', 'Gold']),
  businesses: z.number().int(),
  next: z.object({ name: z.string(), businesses: z.number().int() }).nullable(),
});
export const pointsSummary = z.object({
  points: z.object({ available: money, pending: money }),
  walletKobo: money,
  tier,
  phoneVerified: z.boolean(),
  referral: z.object({
    code: z.string().nullable(),
    referredBy: z.string().nullable(),
    referred: z.number().int(),
    rewarded: z.number().int(),
  }),
});

export const profile = z.object({
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  memberSince: date,
  tier,
  verified: z.object({ email: z.boolean(), phone: z.boolean() }),
  stats: z.object({
    businesses: z.number().int(),
    jobsCompleted: z.number().int(),
    repeatClients: z.number().int(),
    purchases: z.number().int(),
  }),
  work: z.array(
    z.object({
      title: z.string(),
      businessName: z.string(),
      completedAt: date,
    }),
  ),
});
export const ownProfile = profile.extend({ public: z.boolean() });

export const sponsorTaskPage = page(
  z.object({
    id: z.uuid(),
    title: z.string(),
    reviewState: z.string(),
    lifecycle: z.string(),
    model: z.string(),
    endsAt: date,
    budgetKobo: money,
  }),
);

export const confirmation = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  amountKobo: money,
  cashbackKobo: money,
  releaseAt: date,
  createdAt: date,
});
export const campaignSummary = z.object({
  taskId: z.uuid(),
  title: z.string(),
  capacity: z.number().int(),
  cashbackKobo: money,
  budgetKobo: money,
  campaignTerms: campaignTerms.nullable(),
  confirmed: z.number().int(),
  voided: z.number().int(),
  released: z.number().int(),
  remaining: z.number().int(),
  returningShoppers: z.number().int(),
  recent: purchasePage,
});

export const promotionSummary = z.object({
  taskId: z.uuid(),
  title: z.string(),
  prizeKobo: money,
  prizes: z.number().int(),
  claimed: z.number().int(),
  issued: z.number().int(),
  availableToIssue: z.number().int(),
  batches: z.array(
    z.object({
      id: z.uuid(),
      label: z.string(),
      size: z.number().int(),
      createdAt: date,
      claimed: z.number().int(),
      state: z.enum(['issued', 'active', 'revoked']),
    }),
  ),
});
export const issuedBatch = z.object({
  batchId: z.uuid(),
  label: z.string(),
  codes: z.array(z.string()),
});
export const batchState = z.object({
  batchId: z.uuid(),
  state: z.enum(['active', 'revoked']),
});
export const voidResult = z.object({ confirmationId: z.uuid() });
export const releaseResult = z.object({
  confirmationId: z.uuid(),
  cashbackKobo: money,
});
