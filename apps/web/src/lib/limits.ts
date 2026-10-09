'use client';
import { z } from 'zod';
import { useApiRead } from './use-api-read';

const kobo = z.number().int().min(0);
export const limitsSchema = z.object({
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
    friend: z
      .object({
        rewardKobo: kobo,
        maxPercent: z.number(),
        minQualifyingKobo: kobo,
      })
      .nullable(),
    business: z
      .object({
        rewardKobo: kobo,
        maxPercent: z.number(),
        minFundingKobo: kobo,
        minPaidOutKobo: kobo,
        minCustomers: z.number(),
      })
      .nullable(),
    monthlyCount: z.number(),
  }),
});
export type Limits = z.infer<typeof limitsSchema>;

// Used until the live limits load; the API enforces the real ones anyway.
export const fallbackLimits: Limits = {
  funding: { minKobo: 100000, maxKobo: 10000000000 },
  campaigns: {
    minCashbackKobo: 10000,
    minPrizeKobo: 10000,
    minJobRewardKobo: 10000,
    minBudgetKobo: 500000,
    maxRewardKobo: 100000000,
    maxBudgetKobo: 5000000000,
  },
  newBusinesses: {
    days: 14,
    maxFundingKobo: 50000000,
    maxBudgetKobo: 50000000,
  },
  withdrawals: {
    minKobo: 100000,
    maxKobo: 100000000,
    dailyKobo: 100000000,
    dailyCount: 3,
  },
  newAccounts: { days: 7, dailyWithdrawalKobo: 5000000 },
  referrals: { friend: null, business: null, monthlyCount: 0 },
};

// Minimums and maximums an admin sets, for hints and checks in forms.
export function useLimits() {
  const read = useApiRead('settings/limits', limitsSchema);
  return { limits: read.data ?? fallbackLimits, loaded: Boolean(read.data) };
}

export const nairaOfKobo = (k: number) =>
  `₦${(k / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
