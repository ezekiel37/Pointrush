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
  prizeItem: z.string().nullable().optional(),
  voucherCode: z.string().nullable().optional(),
  voucherState: z
    .enum(['awaiting', 'handed_over', 'cashed_out'])
    .nullable()
    .optional(),
  cashAvailableAt: date.nullable().optional(),
});
export const claimList = page(claimResult);
export const handover = z.object({
  redemptionId: z.uuid(),
  item: z.string(),
  handedOver: z.literal(true),
});

export const campaignTerms = z.object({
  minSpendKobo: money,
  holdHours: z.number(),
  placeName: z.string(),
  placeAddress: z.string(),
  repeat: z.literal('monthly').optional(),
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
  // Share of purchases this business voided (180 days); null below 10.
  voidRatePercent: z.number().int().nullable().default(null),
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
  // Voids: the business's reason, until when the shopper can dispute, and
  // the dispute's state ('open', 'upheld' or 'reversed').
  voidReason: z.string().nullable().default(null),
  disputeUntil: date.nullable().default(null),
  dispute: z.enum(['open', 'upheld', 'reversed']).nullable().default(null),
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
  voidsLeft: z.number().int().default(3),
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
  promotionTerms: z
    .object({
      prize: z.object({ item: z.string() }).nullable().optional(),
    })
    .nullable()
    .optional(),
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

export const businessCampaign = z.object({
  id: z.uuid(),
  title: z.string(),
  model: z.string(),
  capacity: z.number().int(),
  used: z.number().int(),
  reviewState: z.string(),
  lifecycle: z.string(),
  endsAt: date,
  rewardKobo: money,
  reviewNote: z.string().nullable().optional(),
  published: z.boolean().optional(),
  cancelled: z.boolean().optional(),
  balanceKobo: money.optional(),
});
export const campaignReturn = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  amountKobo: money,
});
export const businessOverview = z.object({
  business: z.object({ id: z.uuid(), name: z.string() }),
  days: z.number().int(),
  series: z.array(
    z.object({
      day: z.string(),
      purchases: z.number().int(),
      claims: z.number().int(),
    }),
  ),
  purchases: z.object({
    held: z.number().int(),
    ready: z.number().int(),
    paid: z.number().int(),
    voided: z.number().int(),
    returningShoppers: z.number().int(),
  }),
  customers: z.object({
    total: z.number().int(),
    thisMonth: z.number().int(),
    new: z.number().int(),
    returning: z.number().int(),
    regular: z.number().int(),
    longTerm: z.number().int(),
    slippingAway: z.number().int(),
  }),
  availableKobo: money,
  lockedKobo: money,
  paidOutKobo: money,
  live: z.number().int(),
  campaigns: z.array(businessCampaign),
});

export const fundingIntent = z.object({
  intentId: z.uuid(),
  amountKobo: money,
  checkoutUrl: z.url({ protocol: /^https$/ }),
});
export const withdrawal = z.object({
  id: z.uuid(),
  amountKobo: money,
  createdAt: date,
  bank: z.string().nullable().optional(),
  state: z.enum(['held', 'sent', 'paid', 'failed']),
});
export const withdrawalPage = page(withdrawal);

export const notificationFeed = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      at: date,
      unread: z.boolean(),
      title: z.string(),
      body: z.string(),
      href: z.string().regex(/^\/[a-z0-9/_-]*$/i),
    }),
  ),
  unread: z.number().int(),
});

export const staffList = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      username: z.string().nullable(),
      displayName: z.string().nullable(),
      addedAt: date,
      // Staff only act after accepting; activity helps spot cashier fraud.
      accepted: z.boolean().default(true),
      confirmedToday: z.number().int().default(0),
      confirmedWeek: z.number().int().default(0),
      weekCashbackKobo: money.default('0'),
      repeatShoppers: z.number().int().default(0),
    }),
  ),
});
export const workplaces = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      tills: z.array(z.object({ id: z.uuid(), title: z.string() })),
      prizes: z
        .array(z.object({ id: z.uuid(), title: z.string(), item: z.string() }))
        .default([]),
    }),
  ),
  invitations: z
    .array(z.object({ id: z.uuid(), business: z.string() }))
    .default([]),
});

export const bankList = z.object({
  items: z.array(z.object({ code: z.string(), name: z.string() })),
});
export const bankAccount = z.object({
  destination: z
    .object({
      id: z.uuid(),
      bankName: z.string(),
      accountName: z.string(),
      last4: z.string(),
      usableFrom: date,
    })
    .nullable(),
  // "This wasn't me" was pressed; a reviewer must check before withdrawals open.
  locked: z.boolean().default(false),
});
