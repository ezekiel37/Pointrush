import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function healthy(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

const settings = {
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
  referrals: {
    enabled: true,
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
    },
    monthlyCount: 10,
    monthlyKobo: 1000000,
  },
};
const person = '0b9d7e4a-3c2f-4a1b-9e8d-7c6b5a4f3e21';

test('the admin overview shows totals and what needs attention', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/admin/analytics', (route) =>
    route.fulfill({
      json: {
        people: { accounts: 1240, new7d: 85, new30d: 310, verifiedPhones: 900 },
        businesses: { total: 42, new30d: 9, liveCampaigns: 17 },
        activity: { purchases: 5300, purchases7d: 410, prizeClaims: 220 },
        money: {
          fundedKobo: '250000000',
          funded30dKobo: '40000000',
          lockedKobo: '60000000',
          paidToUsersKobo: '150000000',
          inWalletsKobo: '30000000',
          withdrawnKobo: '100000000',
          billsPaidKobo: '5000000',
        },
        queues: {
          campaignsToReview: 3,
          disputesOpen: 1,
          withdrawalsPending: 0,
          billsPending: 0,
        },
        series: Array.from({ length: 14 }, (_, i) => ({
          day: `2026-10-${String(i + 1).padStart(2, '0')}`,
          signups: i * 2,
          purchases: i,
        })),
      },
    }),
  );
  await page.goto('/admin');
  await expect(page.getByText('₦2,500,000')).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Campaigns to review/ }),
  ).toHaveAttribute('href', '/review/campaigns');
  // The phone tab bar leads to people and settings.
  const bar = page.getByRole('navigation', { name: 'Review sections' });
  await expect(bar.getByRole('link', { name: 'People' })).toBeVisible();
  await healthy(page);
});

test('without access the admin explains how to get it', async ({ page }) => {
  await page.route('**/api/v1/admin/analytics', (route) =>
    route.fulfill({ status: 403, json: { statusCode: 403 } }),
  );
  await page.goto('/admin');
  await expect(
    page.getByRole('heading', { name: 'Admin access needed' }),
  ).toBeVisible();
});

test('search finds a business and opens its account', async ({ page }) => {
  await page.route('**/api/v1/admin/search?*', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: person,
            username: 'ada',
            displayName: 'Ada',
            email: 'ada@example.com',
            businessName: 'Mama Put Kitchen',
            accessState: 'active',
            phoneVerified: true,
            createdAt: '2026-09-01T10:00:00Z',
          },
        ],
      },
    }),
  );
  await page.route(`**/api/v1/admin/accounts/${person}`, (route) =>
    route.fulfill({
      json: {
        id: person,
        username: 'ada',
        displayName: 'Ada',
        email: 'ada@example.com',
        accountType: 'business',
        accessState: 'active',
        phoneVerified: true,
        withdrawalsLocked: false,
        business: true,
        createdAt: '2026-09-01T10:00:00Z',
        walletKobo: '0',
        purchases: 0,
        businessProfile: {
          id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
          name: 'Mama Put Kitchen',
          createdAt: '2026-09-01T10:00:00Z',
          campaigns: 4,
          fundedKobo: '5000000',
          availableKobo: '1000000',
          lockedKobo: '3000000',
        },
        history: [],
      },
    }),
  );
  await page.goto('/admin/people');
  await page.getByLabel('Search').fill('mama');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: /Mama Put Kitchen/ }).click();
  await page.waitForURL(`**/admin/people/${person}`);
  await expect(page.getByText('₦50,000')).toBeVisible();
  await healthy(page);
  await expect(
    page.getByRole('link', { name: 'Freeze or unfreeze this account' }),
  ).toHaveAttribute('href', '/review/accounts?username=ada');
});

test('settings check values, show examples and save with a reason', async ({
  page,
}) => {
  let canEdit = false;
  const bodies: { settings: typeof settings; reason: string }[] = [];
  await page.route('**/api/v1/admin/settings', (route) => {
    if (route.request().method() === 'POST') {
      bodies.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          id: '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a',
          current: bodies.at(-1)!.settings,
        },
      });
    }
    return route.fulfill({
      json: {
        current: settings,
        defaults: settings,
        canEdit,
        history: [
          {
            id: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
            reason: 'Defaults installed',
            by: null,
            at: '2026-10-01T00:00:00Z',
          },
        ],
      },
    });
  });
  await page.goto('/admin/settings');
  await expect(page.getByText(/You can view these settings/)).toBeVisible();
  await expect(
    page.getByLabel('Least cash back per purchase (₦)'),
  ).toBeDisabled();

  canEdit = true;
  await page.reload();
  // A ₦200 friend payout earns the inviter ₦100 (50%), not the full ₦200.
  await expect(page.getByText(/pays the inviter ₦100/)).toBeVisible();
  await healthy(page);
  // A per-referral reward above the monthly cap is caught before saving.
  const friendReward = page.getByLabel('Reward up to (₦)').first();
  await friendReward.fill('20000');
  await expect(
    page.getByText('Must not exceed the monthly limit'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Review and save' }),
  ).toBeDisabled();
  await friendReward.fill('300');
  await page.getByLabel('Least cash back per purchase (₦)').fill('150');
  await page.getByRole('button', { name: 'Review and save' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save these settings?' });
  await expect(dialog.getByLabel('Reason')).toBeFocused();
  await expect(
    dialog.getByRole('button', { name: 'Save settings' }),
  ).toBeDisabled();
  await dialog.getByLabel('Reason').fill('Raise floors after small offers');
  await dialog.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]!.reason).toBe('Raise floors after small offers');
  expect(bodies[0]!.settings.campaigns.minCashbackKobo).toBe(15000);
  expect(bodies[0]!.settings.referrals.friend.rewardKobo).toBe(30000);
});
