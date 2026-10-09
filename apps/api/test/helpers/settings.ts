import { sql } from 'drizzle-orm';

// Older tests use tiny amounts (₦5 cash back, ₦10 budgets). This puts every
// minimum at 1 kobo and switches referral cash off unless a test opts in.
export async function lowLimits(
  db: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
  referrals = false,
) {
  const settings = {
    funding: { minKobo: 10000, maxKobo: 10_000_000_000 },
    campaigns: {
      minCashbackKobo: 1,
      minPrizeKobo: 1,
      minJobRewardKobo: 1,
      minBudgetKobo: 1,
      maxRewardKobo: 1_000_000_000,
      maxBudgetKobo: 10_000_000_000,
    },
    newBusinesses: {
      days: 0,
      maxFundingKobo: 10_000_000_000,
      maxBudgetKobo: 10_000_000_000,
    },
    withdrawals: {
      minKobo: 100000,
      maxKobo: 100000000,
      dailyKobo: 100000000,
      dailyCount: 3,
    },
    newAccounts: { days: 0, dailyWithdrawalKobo: 100000000 },
    handles: { reserved: ['shoprite'] },
    referrals: {
      enabled: referrals,
      friend: {
        enabled: true,
        rewardKobo: 20000,
        maxPercent: 50,
        minQualifyingKobo: 20000,
      },
      business: {
        enabled: true,
        rewardKobo: 200000,
        maxPercent: 10,
        minFundingKobo: 2000000,
        minPaidOutKobo: 1000000,
        minCustomers: 5,
      },
      monthlyCount: 10,
      monthlyKobo: 1000000,
    },
  };
  await db.execute(
    sql`insert into platform_settings (settings, reason)
      values (${JSON.stringify(settings)}::jsonb, 'Test limits')`,
  );
}
