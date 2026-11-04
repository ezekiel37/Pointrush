import { test, expect } from '@playwright/test';

// Pilot mode: no SMS provider yet, so phone verification is off and a
// reviewer approves every withdrawal.
const pilotLimits = {
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
    manualApproval: true,
  },
  newAccounts: { days: 7, dailyWithdrawalKobo: 5000000 },
  phone: { required: false },
  referrals: { friend: null, business: null, monthlyCount: 10 },
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/settings/limits', (route) =>
    route.fulfill({ json: pilotLimits }),
  );
  await page.route('**/api/v1/staff/access', (route) =>
    route.fulfill({
      json: { reviewer: true, verified: true, settingsAdmin: true },
    }),
  );
  await page.route('**/api/v1/sponsor/profile', (route) =>
    route.fulfill({ status: 404, json: { statusCode: 404 } }),
  );
});

test('without phone verification, the wallet lets people withdraw and says a reviewer checks it', async ({
  page,
}) => {
  await page.route('**/api/v1/points', (route) =>
    route.fulfill({
      json: {
        points: { available: '0', pending: '0' },
        walletKobo: '200000',
        tier: { name: 'New', businesses: 1, next: null },
        phoneVerified: false,
        referral: { code: null, referredBy: null, referred: 0, rewarded: 0 },
      },
    }),
  );
  await page.route('**/api/v1/purchases?*', (route) =>
    route.fulfill({
      json: { items: [], nextCursor: null, observedAt: '2026-10-05T12:00:00Z' },
    }),
  );
  await page.route('**/api/v1/wallet/withdrawals*', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: '1b1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
            amountKobo: '100000',
            createdAt: '2026-10-05T12:00:00Z',
            state: 'awaiting_approval',
          },
          {
            id: '2b1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
            amountKobo: '50000',
            createdAt: '2026-10-04T12:00:00Z',
            state: 'failed',
            reason: 'Not approved: Same bank account as another account',
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await page.route('**/api/v1/wallet/bank-account', (route) =>
    route.fulfill({
      json: {
        destination: {
          id: '6a1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
          bankName: 'Guaranty Trust Bank',
          accountName: 'ADA OKAFOR',
          last4: '6789',
          usableFrom: '2026-01-01T00:00:00Z',
        },
        locked: false,
      },
    }),
  );
  await page.goto('/wallet');
  await expect(page.getByText(/needs a verified phone number/)).toHaveCount(0);
  await expect(page.getByText('Verify your phone')).toHaveCount(0);
  await expect(page.getByText('Waiting for approval')).toBeVisible();
  await expect(
    page.getByText('Not approved: Same bank account as another account'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await expect(
    page.getByText(/an Acticlaim reviewer checks each withdrawal/),
  ).toBeVisible();
});

test('a reviewer approves or declines each waiting withdrawal with a reason', async ({
  page,
}) => {
  const decisions: unknown[] = [];
  const item = {
    id: '3c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
    amountKobo: '100000',
    createdAt: '2026-10-05T12:00:00Z',
    accountId: '4c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
    accountCreatedAt: '2026-10-01T12:00:00Z',
    username: 'tolu',
    displayName: 'Tolu',
    email: 'tolu@example.com',
    phoneVerified: false,
    bank: 'TOLU ADE, Guaranty Trust Bank ••••6789',
    purchases: 2,
    prizes: 1,
    withdrawals: 1,
  };
  await page.route('**/api/v1/admin/withdrawals/pending', (route) =>
    route.fulfill({ json: { items: decisions.length ? [] : [item] } }),
  );
  await page.route(
    `**/api/v1/admin/withdrawals/${item.id}/decisions`,
    (route) => {
      decisions.push(route.request().postDataJSON());
      return route.fulfill({ json: { id: item.id, decision: 'approved' } });
    },
  );
  await page.goto('/hq/review/withdrawals');
  await expect(page.getByText('Tolu · @tolu')).toBeVisible();
  await expect(page.getByText(/no verified phone/)).toBeVisible();
  await page.getByRole('button', { name: 'Approve and send' }).click();
  await expect(page.getByText(/Say why you approve it/)).toBeVisible();
  expect(decisions).toHaveLength(0);
  await page.getByLabel('Reason').fill('Known pilot customer');
  await page.getByRole('button', { name: 'Approve and send' }).click();
  await expect(page.getByText('No withdrawals are waiting.')).toBeVisible();
  expect(decisions).toEqual([
    { decision: 'approved', reason: 'Known pilot customer' },
  ]);
});
