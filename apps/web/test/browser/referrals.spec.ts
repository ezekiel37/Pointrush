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

const limits = {
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
    friend: { rewardKobo: 20000, maxPercent: 50, minQualifyingKobo: 20000 },
    business: {
      rewardKobo: 200000,
      maxPercent: 10,
      minFundingKobo: 2000000,
      minPaidOutKobo: 1000000,
      minCustomers: 5,
    },
    monthlyCount: 10,
  },
};

test('an invite link opens sign-up with the inviter, for people and businesses', async ({
  page,
}) => {
  await page.goto('/join/ada_k');
  await page.waitForURL('**/signup?ref=ada_k');
  await expect(page.getByText('@ada_k')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Start earning cash back' }),
  ).toBeVisible();
  await healthy(page);
  // Switching to business keeps the invite.
  await page
    .getByRole('navigation', { name: 'Account type' })
    .getByRole('link', { name: /Business/ })
    .click();
  await page.waitForURL('**/signup?as=business&ref=ada_k');
  await expect(page.getByText('@ada_k')).toBeVisible();
  // A business invite link goes straight to business sign-up.
  await page.goto('/join/ada_k?as=business');
  await page.waitForURL('**/signup?as=business&ref=ada_k');
  // A broken link still signs up, without an inviter.
  await page.goto('/join/x');
  await page.waitForURL(/\/signup$/);
});

test('set-up fills in who invited you and explains a wrong username', async ({
  page,
}) => {
  const bodies: Record<string, unknown>[] = [];
  let complete = false;
  await page.route('**/api/v1/accounts/me', (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      bodies.push(body);
      if (body.invitedBy === 'nobody_here')
        return route.fulfill({
          status: 400,
          json: { statusCode: 400, message: 'Nobody', field: 'invitedBy' },
        });
      complete = true;
      return route.fulfill({ status: 201, json: {} });
    }
    return route.fulfill({
      json: complete
        ? {
            onboarding: 'complete',
            accountType: 'personal',
            account: {
              id: '3d9a1c2b-7e6f-4a5b-8c9d-0e1f2a3b4c5d',
              username: 'new_friend',
              displayName: 'New Friend',
              accessState: 'active',
            },
          }
        : {
            onboarding: 'required',
            account: null,
            accountType: 'personal',
            invitedBy: 'ada_k',
          },
    });
  });
  await page.goto('/account');
  const invited = page.getByLabel('Who invited you? (optional)');
  await expect(invited).toHaveValue('ada_k');
  await expect(page.getByText("From @ada_k's invite link.")).toBeVisible();
  await page.getByLabel('Display name', { exact: true }).fill('New Friend');
  await page.getByLabel('Username', { exact: true }).fill('new_friend');
  await invited.fill('nobody_here');
  await page.getByRole('button', { name: 'Complete setup' }).click();
  await expect(
    page.getByText('Nobody has that username. Check it, or leave it empty.'),
  ).toBeVisible();
  await invited.fill('ada_k');
  await page.getByRole('button', { name: 'Complete setup' }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toEqual({
    username: 'new_friend',
    displayName: 'New Friend',
    invitedBy: 'ada_k',
  });
});

test('the invite page has links to copy or share, the rules and who joined', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/settings/limits', (route) =>
    route.fulfill({ json: limits }),
  );
  await page.route('**/api/v1/referrals/me', (route) =>
    route.fulfill({
      json: {
        username: 'ada_k',
        phoneVerified: true,
        invited: 2,
        rewarded: 1,
        earnedKobo: '15000',
        people: [
          {
            username: 'tunde',
            business: false,
            earnedKobo: '15000',
            joinedAt: '2026-10-01T10:00:00Z',
          },
          {
            username: 'mama_put',
            business: true,
            earnedKobo: '0',
            joinedAt: '2026-10-05T10:00:00Z',
          },
        ],
      },
    }),
  );
  await page.goto('/invite');
  const origin = new URL(page.url()).origin;
  await expect(
    page.getByLabel('Invite a friend link', { exact: true }),
  ).toHaveText(`${origin}/join/ada_k`);
  await expect(
    page.getByLabel('Invite a business link', { exact: true }),
  ).toHaveText(`${origin}/join/ada_k?as=business`);
  await expect(
    page.getByText(/Earn up to ₦200 when they first get/),
  ).toBeVisible();
  await expect(page.getByText('+₦150')).toBeVisible();
  await expect(page.getByText('Waiting')).toBeVisible();
  await healthy(page);
  await page.getByRole('button', { name: 'Copy invite a friend link' }).click();
  await expect(page.getByText('Link copied')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `${origin}/join/ada_k`,
  );
  // Share uses the phone's share sheet when there is one.
  await page.evaluate(() => {
    (window as unknown as { shared: unknown[] }).shared = [];
    navigator.share = (data) => {
      (window as unknown as { shared: unknown[] }).shared.push(data);
      return Promise.resolve();
    };
  });
  await page.getByRole('button', { name: 'Share link' }).last().click();
  expect(
    await page.evaluate(
      () => (window as unknown as { shared: { url: string }[] }).shared[0]?.url,
    ),
  ).toBe(`${origin}/join/ada_k?as=business`);
});

test('offers show the invite programme, and the admin funds the pool with a reference', async ({
  page,
}) => {
  await page.route('**/api/v1/settings/limits', (route) =>
    route.fulfill({ json: limits }),
  );
  await page.goto('/offers');
  await expect(
    page.getByRole('link', { name: /Invite a friend or a business/ }),
  ).toHaveAttribute('href', '/invite');

  const bodies: Record<string, unknown>[] = [];
  let balance = '0';
  await page.route('**/api/v1/admin/referrals', (route) =>
    route.fulfill({
      json: {
        balanceKobo: balance,
        fundedKobo: balance,
        paidKobo: '0',
        paidThisMonthKobo: '0',
        rewards: 0,
        invites: 4,
        canFund: true,
        topups: [],
        recent: [],
      },
    }),
  );
  await page.route('**/api/v1/admin/referrals/topups', (route) => {
    bodies.push(route.request().postDataJSON());
    balance = '5000000';
    return route.fulfill({ json: { id: bodies[0]!.id } });
  });
  await page.goto('/admin/referrals');
  await expect(page.getByText(/The pool is empty/)).toBeVisible();
  await page.getByRole('button', { name: 'Add money' }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Add money to the referral pool',
  });
  await dialog.getByLabel('Amount (₦)').fill('50,000');
  await expect(
    dialog.getByRole('button', { name: 'Add ₦50,000' }),
  ).toBeDisabled();
  await dialog.getByLabel('Bank reference').fill('GTB-2026-10-0001');
  await dialog.getByLabel('Reason').fill('October referral budget');
  await healthy(page);
  await dialog.getByRole('button', { name: 'Add ₦50,000' }).click();
  await expect(
    page.getByText('₦50,000 added to the referral pool'),
  ).toBeVisible();
  expect(bodies[0]).toMatchObject({
    amountKobo: '5000000',
    bankReference: 'GTB-2026-10-0001',
    reason: 'October referral budget',
  });
});
