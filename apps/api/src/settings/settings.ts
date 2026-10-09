import { BadRequestException } from '@nestjs/common';
import { desc } from 'drizzle-orm';
import { z } from 'zod';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import { platformSettings } from './settings.schema.js';

const naira = (n: number) => n * 100;
// Amounts are whole kobo in JSON numbers; ceilings keep a typo (an extra
// zero or two) from becoming a real loss.
const kobo = (max: number) => z.number().int().min(0).max(max);
const percent = (max: number) => z.number().int().min(1).max(max);

export const settingsSchema = z
  .object({
    funding: z
      .object({
        // Smallest and largest single top-up a business can make.
        minKobo: kobo(naira(1_000_000)).min(naira(100)),
        maxKobo: kobo(naira(100_000_000)),
      })
      .strict(),
    campaigns: z
      .object({
        // Smallest cash back per purchase, prize, and job payment.
        minCashbackKobo: kobo(naira(100_000)).min(1),
        minPrizeKobo: kobo(naira(100_000)).min(1),
        minJobRewardKobo: kobo(naira(100_000)).min(1),
        // Smallest total a campaign can lock (reward × places).
        minBudgetKobo: kobo(naira(10_000_000)).min(1),
        // Largest payment per place, and largest total one campaign locks.
        maxRewardKobo: kobo(naira(10_000_000)).min(1),
        maxBudgetKobo: kobo(naira(100_000_000)).min(1),
      })
      .strict(),
    // Lower limits while a business is new on Acticlaim.
    newBusinesses: z
      .object({
        days: z.number().int().min(0).max(365),
        maxFundingKobo: kobo(naira(100_000_000)).min(1),
        maxBudgetKobo: kobo(naira(100_000_000)).min(1),
      })
      .strict(),
    // Withdrawals to a bank. The database enforces these too.
    withdrawals: z
      .object({
        minKobo: kobo(naira(100_000)).min(naira(100)),
        maxKobo: kobo(naira(5_000_000)).min(naira(100)),
        dailyKobo: kobo(naira(10_000_000)).min(naira(100)),
        dailyCount: z.number().int().min(1).max(20),
      })
      .strict(),
    // Lower daily withdrawals while an account is new.
    newAccounts: z
      .object({
        days: z.number().int().min(0).max(365),
        dailyWithdrawalKobo: kobo(naira(10_000_000)).min(naira(100)),
      })
      .strict(),
    handles: z
      .object({
        // Handles nobody may take, on top of the built-in list (admin,
        // acticlaim, support and similar). Big brand names belong here.
        reserved: z
          .array(
            z
              .string()
              .regex(/^[a-z][a-z0-9_]{1,28}[a-z0-9]$/, 'Use a valid handle'),
          )
          .max(1000),
      })
      .strict(),
    referrals: z
      .object({
        enabled: z.boolean(),
        friend: z
          .object({
            enabled: z.boolean(),
            // Paid to the inviter when the friend's first cash back or job
            // payment settles: the smaller of rewardKobo and maxPercent of
            // what the friend was paid, so a ₦50 offer never earns ₦500.
            rewardKobo: kobo(naira(50_000)),
            maxPercent: percent(100),
            minQualifyingKobo: kobo(naira(100_000)),
          })
          .strict(),
        business: z
          .object({
            enabled: z.boolean(),
            // Paid when a referred business has funded at least
            // minFundingKobo and paid at least minPaidOutKobo to its own
            // customers: the smaller of rewardKobo and maxPercent of that
            // paid-out amount.
            rewardKobo: kobo(naira(200_000)),
            maxPercent: percent(50),
            minFundingKobo: kobo(naira(10_000_000)),
            minPaidOutKobo: kobo(naira(10_000_000)).min(1),
            // Paid to at least this many different customers.
            minCustomers: z.number().int().min(1).max(1000),
          })
          .strict(),
        // Per inviter, per calendar month (Lagos).
        monthlyCount: z.number().int().min(0).max(1000),
        monthlyKobo: kobo(naira(1_000_000)),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    if (v.funding.maxKobo < v.funding.minKobo)
      issue(['funding', 'maxKobo'], 'Must be at least the minimum top-up');
    const c = v.campaigns;
    for (const key of [
      'minCashbackKobo',
      'minPrizeKobo',
      'minJobRewardKobo',
    ] as const)
      if (c[key] > c.maxRewardKobo)
        issue(['campaigns', key], 'Must not exceed the largest payment');
    if (c.maxBudgetKobo < c.minBudgetKobo)
      issue(['campaigns', 'maxBudgetKobo'], 'Must be at least the minimum');
    if (v.newBusinesses.maxBudgetKobo > c.maxBudgetKobo)
      issue(
        ['newBusinesses', 'maxBudgetKobo'],
        'Must not exceed the limit for all businesses',
      );
    if (v.newBusinesses.maxBudgetKobo < c.minBudgetKobo)
      issue(
        ['newBusinesses', 'maxBudgetKobo'],
        'Must be at least the campaign minimum, or new businesses cannot start',
      );
    if (v.newBusinesses.maxFundingKobo > v.funding.maxKobo)
      issue(
        ['newBusinesses', 'maxFundingKobo'],
        'Must not exceed the top-up limit for all businesses',
      );
    if (v.newBusinesses.maxFundingKobo < v.funding.minKobo)
      issue(
        ['newBusinesses', 'maxFundingKobo'],
        'Must be at least the minimum top-up',
      );
    const w = v.withdrawals;
    if (w.maxKobo < w.minKobo)
      issue(['withdrawals', 'maxKobo'], 'Must be at least the minimum');
    if (w.dailyKobo < w.maxKobo)
      issue(
        ['withdrawals', 'dailyKobo'],
        'Must be at least one largest withdrawal',
      );
    if (v.newAccounts.dailyWithdrawalKobo > w.dailyKobo)
      issue(
        ['newAccounts', 'dailyWithdrawalKobo'],
        'Must not exceed the daily limit for everyone',
      );
    if (v.newAccounts.dailyWithdrawalKobo < w.minKobo)
      issue(
        ['newAccounts', 'dailyWithdrawalKobo'],
        'Must be at least the smallest withdrawal',
      );
    if (v.campaigns.minBudgetKobo < v.campaigns.minCashbackKobo)
      issue(
        ['campaigns', 'minBudgetKobo'],
        'Must be at least the minimum cash back',
      );
    if (v.referrals.business.minFundingKobo < v.funding.minKobo)
      issue(
        ['referrals', 'business', 'minFundingKobo'],
        'Must be at least the minimum top-up',
      );
    if (
      v.referrals.business.minFundingKobo < v.referrals.business.minPaidOutKobo
    )
      issue(
        ['referrals', 'business', 'minFundingKobo'],
        'Must be at least the paid-out amount that qualifies',
      );
    // Never promise more for one referral than a month allows.
    for (const kind of ['friend', 'business'] as const)
      if (v.referrals[kind].rewardKobo > v.referrals.monthlyKobo)
        issue(
          ['referrals', kind, 'rewardKobo'],
          'Must not exceed the monthly limit per person',
        );
  });
export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = {
  funding: { minKobo: naira(1_000), maxKobo: naira(100_000_000) },
  campaigns: {
    minCashbackKobo: naira(100),
    minPrizeKobo: naira(100),
    minJobRewardKobo: naira(100),
    minBudgetKobo: naira(5_000),
    maxRewardKobo: naira(1_000_000),
    maxBudgetKobo: naira(50_000_000),
  },
  newBusinesses: {
    days: 14,
    maxFundingKobo: naira(500_000),
    maxBudgetKobo: naira(500_000),
  },
  // Same as the limits the database enforced before settings existed.
  withdrawals: {
    minKobo: naira(1_000),
    maxKobo: naira(1_000_000),
    dailyKobo: naira(1_000_000),
    dailyCount: 3,
  },
  newAccounts: { days: 7, dailyWithdrawalKobo: naira(50_000) },
  handles: {
    reserved: [
      'shoprite',
      'dangote',
      'mtn',
      'airtel',
      'glo',
      'gtbank',
      'access_bank',
      'zenith_bank',
      'first_bank',
      'opay',
      'palmpay',
      'moniepoint',
      'kuda',
      'jumia',
      'konga',
      'chicken_republic',
      'dominos',
      'kfc',
      'coca_cola',
      'pepsi',
    ],
  },
  referrals: {
    enabled: true,
    friend: {
      enabled: true,
      rewardKobo: naira(200),
      maxPercent: 50,
      minQualifyingKobo: naira(200),
    },
    business: {
      enabled: true,
      rewardKobo: naira(2_000),
      maxPercent: 10,
      minFundingKobo: naira(20_000),
      minPaidOutKobo: naira(10_000),
      minCustomers: 5,
    },
    monthlyCount: 10,
    monthlyKobo: naira(10_000),
  },
};

export function parseSettings(value: unknown): Settings {
  const result = settingsSchema.safeParse(value);
  if (!result.success)
    throw new BadRequestException({
      statusCode: 400,
      message: 'Invalid settings',
      reason: 'invalid_settings',
      issues: result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  return result.data;
}

// The settings in force. A stored row that no longer validates (for example
// after a field is added) falls back to the defaults for safety.
export async function readSettings(db: FundingDatabase) {
  const [row] = await db
    .select()
    .from(platformSettings)
    .orderBy(desc(platformSettings.version))
    .limit(1);
  const parsed = settingsSchema.safeParse(row?.settings);
  return parsed.success ? parsed.data : defaultSettings;
}

const shown = (k: number) =>
  `₦${(k / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

export { shown as nairaText };

export function belowMinimum(message: string) {
  return new BadRequestException({
    statusCode: 400,
    message,
    reason: 'below_minimum',
  });
}

// Campaign limits: tiny rewards invite abuse; very large ones, especially
// from a business that is new here, need to grow into trust.
export function checkTaskMinimums(
  settings: Settings,
  value: { model: string; rewardKobo: bigint; capacity: number },
  businessSince?: Date,
  now = Date.now(),
) {
  const c = settings.campaigns;
  const [floor, label] =
    value.model === 'purchase_cashback'
      ? [c.minCashbackKobo, 'Cash back per purchase']
      : value.model === 'claim_code'
        ? [c.minPrizeKobo, 'Each prize']
        : [c.minJobRewardKobo, 'Each job payment'];
  if (value.rewardKobo < BigInt(floor))
    throw belowMinimum(`${label} must be at least ${shown(floor)}`);
  if (value.rewardKobo > BigInt(c.maxRewardKobo))
    throw aboveMaximum(`${label} can be at most ${shown(c.maxRewardKobo)}`);
  const budget = value.rewardKobo * BigInt(value.capacity);
  if (budget < BigInt(c.minBudgetKobo))
    throw belowMinimum(
      `A campaign must lock at least ${shown(c.minBudgetKobo)} in total`,
    );
  const isNew = businessSince && isNewBusiness(settings, businessSince, now);
  const cap = isNew
    ? Math.min(c.maxBudgetKobo, settings.newBusinesses.maxBudgetKobo)
    : c.maxBudgetKobo;
  if (budget > BigInt(cap))
    throw aboveMaximum(
      isNew
        ? `For your first ${settings.newBusinesses.days} days, a campaign can lock at most ${shown(cap)}`
        : `A campaign can lock at most ${shown(cap)}`,
    );
}

export function isNewBusiness(
  settings: Settings,
  since: Date,
  now = Date.now(),
) {
  return now - since.getTime() < settings.newBusinesses.days * 86_400_000;
}

export function aboveMaximum(message: string) {
  return new BadRequestException({
    statusCode: 400,
    message,
    reason: 'above_maximum',
  });
}
