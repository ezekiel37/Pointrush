import { z } from 'zod';
import { money } from './api';

const date = z.iso.datetime({ offset: true });

export const analytics = z.object({
  people: z.object({
    accounts: z.number(),
    new7d: z.number(),
    new30d: z.number(),
    verifiedPhones: z.number(),
  }),
  businesses: z.object({
    total: z.number(),
    new30d: z.number(),
    liveCampaigns: z.number(),
  }),
  activity: z.object({
    purchases: z.number(),
    purchases7d: z.number(),
    prizeClaims: z.number(),
  }),
  money: z.object({
    fundedKobo: money,
    funded30dKobo: money,
    lockedKobo: money,
    paidToUsersKobo: money,
    inWalletsKobo: money,
    withdrawnKobo: money,
    billsPaidKobo: money,
  }),
  queues: z.object({
    campaignsToReview: z.number(),
    disputesOpen: z.number(),
    withdrawalsPending: z.number(),
    billsPending: z.number(),
  }),
  series: z.array(
    z.object({ day: z.string(), signups: z.number(), purchases: z.number() }),
  ),
});

export const searchResults = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      username: z.string().nullable(),
      displayName: z.string().nullable(),
      email: z.string().nullable(),
      businessName: z.string().nullable(),
      accessState: z.string(),
      phoneVerified: z.boolean(),
      createdAt: date,
    }),
  ),
});

export const personDetail = z.object({
  id: z.uuid(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  accountType: z.enum(['personal', 'business']),
  accessState: z.string(),
  phoneVerified: z.boolean(),
  withdrawalsLocked: z.boolean(),
  createdAt: date,
  walletKobo: money,
  purchases: z.number(),
  businessProfile: z
    .object({
      id: z.uuid(),
      name: z.string(),
      createdAt: date,
      campaigns: z.number(),
      fundedKobo: money,
      availableKobo: money,
      lockedKobo: money,
    })
    .nullable(),
  history: z.array(
    z.object({
      fromState: z.string(),
      toState: z.string(),
      reason: z.string(),
      by: z.string().nullable(),
      at: date,
    }),
  ),
});

const kobo = z.number().int().min(0);
export const settingsShape = z.object({
  funding: z.object({ minKobo: kobo, maxKobo: kobo }),
  campaigns: z.object({
    minCashbackKobo: kobo,
    minPrizeKobo: kobo,
    minJobRewardKobo: kobo,
    minBudgetKobo: kobo,
    maxRewardKobo: kobo,
    maxBudgetKobo: kobo,
  }),
  newBusinesses: z.object({
    days: z.number(),
    maxFundingKobo: kobo,
    maxBudgetKobo: kobo,
  }),
  withdrawals: z.object({
    minKobo: kobo,
    maxKobo: kobo,
    dailyKobo: kobo,
    dailyCount: z.number(),
  }),
  newAccounts: z.object({ days: z.number(), dailyWithdrawalKobo: kobo }),
  referrals: z.object({
    enabled: z.boolean(),
    friend: z.object({
      enabled: z.boolean(),
      rewardKobo: kobo,
      maxPercent: z.number(),
      minQualifyingKobo: kobo,
    }),
    business: z.object({
      enabled: z.boolean(),
      rewardKobo: kobo,
      maxPercent: z.number(),
      minFundingKobo: kobo,
      minPaidOutKobo: kobo,
    }),
    monthlyCount: z.number(),
    monthlyKobo: kobo,
  }),
});
export type PlatformSettings = z.infer<typeof settingsShape>;
export const settingsRead = z.object({
  current: settingsShape,
  defaults: settingsShape,
  canEdit: z.boolean(),
  history: z.array(
    z.object({
      id: z.uuid(),
      reason: z.string(),
      by: z.string().nullable(),
      at: date,
    }),
  ),
});

// Naira from whole kobo numbers, for settings shown as plain amounts.
export const nairaOf = (kobo: number) =>
  `₦${(kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
