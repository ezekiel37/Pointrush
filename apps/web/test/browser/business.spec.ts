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

test('a business is created against the current terms, then sent to add funds', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let version: string | null = null;
  await page.route('**/api/v1/sponsor/terms', (route) =>
    route.fulfill({ json: { version } }),
  );
  const bodies: unknown[] = [];
  await page.route('**/api/v1/sponsor/profile', (route) => {
    // The sidebar also reads the profile; only creation requests count.
    if (route.request().method() !== 'POST')
      return route.fulfill({ status: 404, json: { statusCode: 404 } });
    bodies.push(route.request().postDataJSON());
    return route.fulfill({
      json: { id: '5b0f8d4e-1c2a-4e7a-9f3b-2d6c8a1e4f70', name: 'Mama Put' },
    });
  });
  await page.route('**/api/v1/business/overview?*', (route) =>
    route.fulfill({ status: 404, json: { statusCode: 404 } }),
  );

  await page.goto('/business/setup');
  await expect(page.getByText('Business accounts open soon')).toBeVisible();

  version = 'business-2026-10';
  await page.reload();
  await healthy(page);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page.getByText('Enter your business name.')).toBeVisible();
  await page.getByLabel('Business name').fill('  Mama Put  ');
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page.getByText('Accept the business terms')).toBeVisible();
  expect(bodies).toHaveLength(0);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create business' }).click();
  await page.waitForURL('**/business/funds');
  expect(bodies).toEqual([
    { name: 'Mama Put', acceptTerms: true, termsVersion: 'business-2026-10' },
  ]);
});

const businessId = '5b0f8d4e-1c2a-4e7a-9f3b-2d6c8a1e4f70';
function overview(campaigns: Record<string, unknown>[] = []) {
  return {
    business: { id: businessId, name: 'Mama Put Kitchen' },
    days: 7,
    series: Array.from({ length: 7 }, (_, i) => ({
      day: `2026-10-0${i + 1}`,
      purchases: 0,
      claims: 0,
    })),
    purchases: { held: 0, ready: 0, paid: 0, voided: 0, returningShoppers: 0 },
    customers: {
      total: 0,
      thisMonth: 0,
      new: 0,
      returning: 0,
      regular: 0,
      longTerm: 0,
      slippingAway: 0,
    },
    availableKobo: '2500000',
    lockedKobo: '0',
    paidOutKobo: '0',
    live: 0,
    campaigns,
  };
}

test('a cash back offer locks exactly what the business can afford and survives a dropped response', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/business/overview?*', (route) =>
    route.fulfill({ json: overview() }),
  );
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/v1/sponsor/tasks', (route) => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) return route.abort();
    return route.fulfill({ json: { id: businessId } });
  });
  await page.goto('/business/campaigns/new');
  await page.getByRole('button', { name: /Lock money and submit/ }).click();
  await expect(page.getByText('Give the campaign a name.')).toBeVisible();
  expect(bodies).toHaveLength(0);

  await page.getByLabel('Campaign name').fill('₦500 back on lunch');
  await page.getByLabel('What shoppers do').fill('Buy any meal.');
  await page.getByLabel('Cash back per purchase (₦)').fill('500');
  await page.getByLabel('Number of shoppers').fill('100');
  // ₦50,000 needed against ₦25,000 available: submitting is blocked.
  await expect(page.getByText('You need ₦25,000 more.')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Lock ₦50,000 and submit' }),
  ).toBeDisabled();
  await page.getByLabel('Number of shoppers').fill('40');
  await page.getByLabel('Minimum spend (₦)').fill('3,000');
  await page.getByRole('button', { name: 'Once a month' }).click();
  await expect(page.getByText(/again each new month/)).toBeVisible();
  await page.getByLabel('Place name').fill('Mama Put Kitchen');
  await page.getByLabel('Address').fill('12 Campus Road, Ibadan');
  await page.getByRole('button', { name: '7 days' }).click();
  await healthy(page);
  await page.getByRole('button', { name: 'Lock ₦20,000 and submit' }).click();
  await expect(
    page.getByText(/will not be created or charged twice/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Lock ₦20,000 and submit' }).click();
  await page.waitForURL('**/business/campaigns?created=1');
  await expect(page.getByText('Created and money locked.')).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0]).toMatchObject({
    model: 'purchase_cashback',
    capacity: 40,
    rewardKobo: '50000',
    campaignTerms: {
      minSpendKobo: '300000',
      holdHours: 168,
      placeName: 'Mama Put Kitchen',
      placeAddress: '12 Campus Road, Ibadan',
      repeat: 'monthly',
    },
  });
});

test('a group offer sends its target and base amount', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/business/overview?*', (route) =>
    route.fulfill({ json: overview() }),
  );
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/v1/sponsor/tasks', (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { id: businessId } });
  });
  await page.goto('/business/campaigns/new');
  await page.getByLabel('Campaign name').fill('Bring your friends');
  await page.getByLabel('What shoppers do').fill('Buy any meal.');
  await page.getByLabel('Cash back per purchase (₦)').fill('1,000');
  await page.getByLabel('Number of shoppers').fill('20');
  await page.getByRole('button', { name: 'Group offer' }).click();
  await page.getByLabel('Buyers needed').fill('30');
  await page.getByLabel('If not reached, each gets (₦)').fill('1,000');
  await page.getByLabel('Place name').fill('Mama Put Kitchen');
  await page.getByLabel('Address').fill('12 Campus Road, Ibadan');
  await page.getByRole('button', { name: /Lock ₦20,000 and submit/ }).click();
  await expect(
    page.getByText(/From 2 up to the number of shoppers/),
  ).toBeVisible();
  await expect(
    page.getByText('Enter an amount below the full cash back.'),
  ).toBeVisible();
  await page.getByLabel('Buyers needed').fill('10');
  await page.getByLabel('If not reached, each gets (₦)').fill('300');
  await healthy(page);
  await page.getByRole('button', { name: /Lock ₦20,000 and submit/ }).click();
  await page.waitForURL('**/business/campaigns?created=1');
  expect(bodies[0]).toMatchObject({
    campaignTerms: { group: { target: 10, baseKobo: '30000' } },
  });
  expect(bodies[0]).not.toHaveProperty('campaignTerms.repeat');
});

test('a bring-a-friend offer sends the inviter share', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/business/overview?*', (route) =>
    route.fulfill({ json: overview() }),
  );
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/v1/sponsor/tasks', (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { id: businessId } });
  });
  await page.goto('/business/campaigns/new');
  await page.getByLabel('Campaign name').fill('Bring a friend');
  await page.getByLabel('What shoppers do').fill('Buy any meal.');
  await page.getByLabel('Cash back per purchase (₦)').fill('1,000');
  await page.getByLabel('Number of shoppers').fill('20');
  await page.getByRole('button', { name: 'Bring a friend' }).click();
  await page.getByLabel('Goes to the customer who invited (₦)').fill('400');
  await expect(page.getByText('The new customer gets ₦600.')).toBeVisible();
  await page.getByLabel('Place name').fill('Mama Put Kitchen');
  await page.getByLabel('Address').fill('12 Campus Road, Ibadan');
  await healthy(page);
  await page.getByRole('button', { name: /Lock ₦20,000 and submit/ }).click();
  await page.waitForURL('**/business/campaigns?created=1');
  expect(bodies[0]).toMatchObject({
    campaignTerms: { referral: { referrerKobo: '40000' } },
  });
});

test('a prize promotion funds every code: there is no chance mode', async ({
  page,
}) => {
  await page.route('**/api/v1/business/overview?*', (route) =>
    route.fulfill({ json: overview() }),
  );
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/v1/sponsor/tasks', (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { id: businessId } });
  });
  await page.goto('/business/promotions/new');
  await page.getByLabel('Campaign name').fill('Win with every crate');
  await page.getByLabel('How to take part').fill('Scratch and enter the code.');
  await page.getByLabel('Prize per winning code (₦)').fill('5,000');
  await page.getByLabel('Number of prizes').fill('4');
  await page.getByLabel('Where customers find codes').fill('Under the cap');
  await expect(
    page.getByRole('button', { name: 'Some codes win' }),
  ).toHaveCount(0);
  await expect(page.getByText(/Acticlaim does not run draws/)).toBeVisible();
  await healthy(page);
  await page.getByRole('button', { name: 'Lock ₦20,000 and submit' }).click();
  await page.waitForURL('**/business/promotions?created=1');
  expect(bodies[0]).toMatchObject({
    model: 'claim_code',
    rewardKobo: '500000',
    promotionTerms: {
      mode: 'every_code_wins',
      permit: null,
      claimLimitPerPerson: 1,
      howToGetCodes: 'Under the cap',
    },
  });
});

test('an approved campaign goes live from its list', async ({ page }) => {
  let live = false;
  await page.route('**/api/v1/business/overview?*', (route) =>
    route.fulfill({
      json: overview([
        {
          id: businessId,
          title: 'Lunch cash back',
          model: 'purchase_cashback',
          capacity: 40,
          used: 0,
          reviewState: 'approved',
          lifecycle: live ? 'published' : 'draft',
          endsAt: '2099-12-10T18:00:00Z',
          rewardKobo: '50000',
        },
      ]),
    }),
  );
  let published = 0;
  await page.route(`**/api/v1/work/tasks/${businessId}/publish`, (route) => {
    published++;
    live = true;
    return route.fulfill({ json: { taskId: businessId } });
  });
  await page.goto('/business/campaigns');
  await expect(page.getByText('Approved, ready to go live')).toBeVisible();
  await healthy(page);
  await page.getByRole('button', { name: 'Go live' }).click();
  await expect(page.getByText('Approved, ready to go live')).toBeHidden();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  expect(published).toBe(1);
});

test('a reviewer approves only after every check, and the decision is recorded once', async ({
  page,
}) => {
  const task = {
    id: businessId,
    sponsorName: 'Mama Put Kitchen',
    title: '₦500 back on lunch',
    instructions: 'Buy any meal.',
    proofRequirements: 'Purchase confirmed by the business at the till.',
    rejectionCriteria: 'Refunded or cancelled orders.',
    model: 'purchase_cashback',
    capacity: 40,
    rewardKobo: '50000',
    budgetKobo: '2000000',
    startsAt: '2099-10-06T09:00:00Z',
    endsAt: '2099-11-06T09:00:00Z',
    termsVersion: 1,
    termsHash: 'a'.repeat(64),
    campaignTerms: {
      minSpendKobo: '300000',
      holdHours: 72,
      placeName: 'Mama Put Kitchen',
      placeAddress: '12 Campus Road, Ibadan',
    },
    promotionTerms: null,
  };
  let decided = false;
  await page.route('**/api/v1/admin/reviews/tasks?*', (route) =>
    route.fulfill({
      json: { items: decided ? [] : [task], nextCursor: null },
    }),
  );
  await page.route(`**/api/v1/admin/reviews/tasks/${businessId}`, (route) =>
    route.fulfill({ json: task }),
  );
  const bodies: Record<string, unknown>[] = [];
  await page.route(
    `**/api/v1/admin/reviews/tasks/${businessId}/decision`,
    (route) => {
      bodies.push(route.request().postDataJSON());
      decided = true;
      return route.fulfill({ json: { id: businessId } });
    },
  );
  await page.goto('/review/campaigns');
  await page.getByRole('link', { name: '₦500 back on lunch' }).click();
  await expect(page.getByText('12 Campus Road, Ibadan')).toBeVisible();
  await expect(page.getByText('₦500 × 40 = ₦20,000 locked')).toBeVisible();
  await healthy(page);
  await expect(
    page.getByRole('button', { name: 'Approve campaign' }),
  ).toBeDisabled();
  for (const box of await page.getByRole('checkbox').all()) await box.check();
  await page.getByLabel('What you checked').fill('Address and terms checked.');
  await page.getByRole('button', { name: 'Approve campaign' }).click();
  await page.waitForURL('**/review/campaigns?decided=1');
  await expect(page.getByText('Nothing waiting for review.')).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({
    decision: 'approved',
    termsVersion: 1,
    reason: 'Address and terms checked.',
  });
});

test('a large campaign needs a second, different reviewer', async ({
  page,
}) => {
  const task = {
    id: businessId,
    sponsorName: 'Big Brew Ltd',
    title: 'Win with every crate',
    instructions: 'Buy a crate.',
    proofRequirements: 'Code under the cap.',
    rejectionCriteria: 'Codes from outside the promotion.',
    model: 'purchase_cashback',
    capacity: 1000,
    rewardKobo: '200000',
    budgetKobo: '200000000',
    startsAt: '2099-10-06T09:00:00Z',
    endsAt: '2099-11-06T09:00:00Z',
    termsVersion: 1,
    termsHash: 'a'.repeat(64),
    campaignTerms: {
      minSpendKobo: '0',
      holdHours: 72,
      placeName: 'Big Brew depot',
      placeAddress: '1 Depot Road, Aba',
    },
    promotionTerms: null,
    firstApprovedBy: null as string | null,
  };
  await page.route('**/api/v1/admin/reviews/tasks?*', (route) =>
    route.fulfill({ json: { items: [task], nextCursor: null } }),
  );
  await page.route(`**/api/v1/admin/reviews/tasks/${businessId}`, (route) =>
    route.fulfill({ json: task }),
  );
  let calls = 0;
  await page.route(
    `**/api/v1/admin/reviews/tasks/${businessId}/decision`,
    (route) => {
      calls += 1;
      if (calls === 1) {
        task.firstApprovedBy = 'b1e2d3f4-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
        return route.fulfill({
          json: { awaitingSecondReviewer: true, taskId: businessId },
        });
      }
      return route.fulfill({
        status: 409,
        json: { statusCode: 409, reason: 'second_reviewer_required' },
      });
    },
  );
  await page.goto(`/review/campaigns/${businessId}`);
  await expect(
    page.getByText(/two different reviewers must approve it/),
  ).toBeVisible();
  await healthy(page);
  for (const box of await page.getByRole('checkbox').all()) await box.check();
  await page.getByLabel('What you checked').fill('Permit and terms checked.');
  await page.getByRole('button', { name: 'Approve campaign' }).click();
  await page.waitForURL('**/review/campaigns?decided=first');
  await expect(page.getByText(/A second reviewer must approve/)).toBeVisible();
  await expect(page.getByText('Needs 2nd approval')).toBeVisible();
  // The same reviewer trying again is told someone else must do it.
  await page.getByRole('link', { name: 'Win with every crate' }).click();
  await expect(page.getByText(/One reviewer has approved/)).toBeVisible();
  for (const box of await page.getByRole('checkbox').all()) await box.check();
  await page.getByLabel('What you checked').fill('Checked again.');
  await page.getByRole('button', { name: 'Approve campaign' }).click();
  await expect(
    page.getByText(/A different reviewer must give the second/),
  ).toBeVisible();
});

test('without reviewer access the queue explains how to get it', async ({
  page,
}) => {
  await page.route('**/api/v1/admin/reviews/tasks?*', (route) =>
    route.fulfill({ status: 403, json: { statusCode: 403 } }),
  );
  await page.goto('/review/campaigns');
  await expect(page.getByText(/recent authenticator check/)).toBeVisible();
});

test('a business cancels a campaign that is not live and gets its money back once', async ({
  page,
}) => {
  let cancelled = false;
  const draftId = '6c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
  await page.route('**/api/v1/business/overview?*', (route) =>
    route.fulfill({
      json: overview([
        {
          id: draftId,
          title: 'Weekend cash back',
          model: 'purchase_cashback',
          capacity: 40,
          used: 0,
          reviewState: 'pending_review',
          lifecycle: 'draft',
          endsAt: '2099-12-10T18:00:00Z',
          rewardKobo: '50000',
          published: false,
          cancelled,
          balanceKobo: cancelled ? '0' : '2000000',
        },
      ]),
    }),
  );
  const bodies: unknown[] = [];
  await page.route(`**/api/v1/campaigns/${draftId}/returns`, (route) => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) return route.abort();
    cancelled = true;
    return route.fulfill({
      json: { id: draftId, taskId: draftId, amountKobo: '2000000' },
    });
  });
  await page.goto('/business/campaigns');
  await page.getByRole('button', { name: 'Cancel and return' }).click();
  await expect(page.getByText(/It can never go live afterwards/)).toBeVisible();
  await healthy(page);
  await page.getByRole('button', { name: 'Yes, cancel it' }).click();
  await expect(page.getByText(/never be returned twice/)).toBeVisible();
  await page.getByRole('button', { name: 'Yes, cancel it' }).click();
  await expect(
    page.getByText('₦20,000 is back in your available balance.'),
  ).toBeVisible();
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
});

test('an owner invites and removes till staff, sees their activity, and staff accept to see their tills', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const staffId = '7d1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
  let members: Record<string, unknown>[] = [];
  await page.route('**/api/v1/business/staff', (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      if (body.username === '@ghost')
        return route.fulfill({ status: 404, json: { statusCode: 404 } });
      members = [
        {
          id: staffId,
          username: 'ada',
          displayName: 'Ada Obi',
          addedAt: '2026-10-05T12:00:00Z',
          accepted: false,
        },
      ];
    }
    return route.fulfill({ json: { items: members } });
  });
  await page.route(`**/api/v1/business/staff/${staffId}/removals`, (route) => {
    members = [];
    return route.fulfill({ json: { items: [] } });
  });
  await page.goto('/business/staff');
  await expect(page.getByText('No staff yet.')).toBeVisible();
  await healthy(page);
  await page.getByLabel('Their Acticlaim username').fill('@ghost');
  await page.getByRole('button', { name: 'Invite to staff' }).click();
  await expect(page.getByText(/No active Acticlaim account/)).toBeVisible();
  await page.getByLabel('Their Acticlaim username').fill('@ada');
  await page.getByRole('button', { name: 'Invite to staff' }).click();
  await expect(page.getByText('Ada Obi')).toBeVisible();
  await expect(page.getByText('Waiting to accept')).toBeVisible();
  // Once accepted, the owner sees what each cashier confirmed.
  members = [
    {
      ...members[0],
      accepted: true,
      confirmedToday: 4,
      confirmedWeek: 31,
      weekCashbackKobo: '1550000',
      repeatShoppers: 2,
    },
  ];
  await page.reload();
  await expect(
    page.getByText(
      'Confirmed 4 today · 31 this week · ₦15,500 cash back this week',
    ),
  ).toBeVisible();
  await expect(
    page.getByText(/Confirmed the same 2 shoppers 3 or more times/),
  ).toBeVisible();
  await healthy(page);
  await page.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(page.getByText('No staff yet.')).toBeVisible();

  let accepted = false;
  const workplaces = () => ({
    items: accepted
      ? [
          {
            id: businessId,
            name: 'Mama Put Kitchen',
            tills: [{ id: businessId, title: 'Lunch cash back' }],
          },
        ]
      : [],
    invitations: accepted
      ? []
      : [{ id: staffId, business: 'Mama Put Kitchen' }],
  });
  await page.route('**/api/v1/staff/workplaces', (route) =>
    route.fulfill({ json: workplaces() }),
  );
  await page.route(
    `**/api/v1/staff/invitations/${staffId}/acceptances`,
    (route) => {
      accepted = true;
      return route.fulfill({ json: workplaces() });
    },
  );
  await page.goto('/staff');
  await expect(
    page.getByText(/Only accept if you really work there/),
  ).toBeVisible();
  await healthy(page);
  await page.getByRole('button', { name: 'Accept' }).click();
  await expect(
    page.getByRole('link', { name: 'Lunch cash back' }),
  ).toHaveAttribute('href', `/business/campaigns/${businessId}`);
  await healthy(page);
});

test('a business confirms a prize handover only with the winner voucher', async ({
  page,
}) => {
  await page.route(`**/api/v1/promotions/${businessId}/summary`, (route) =>
    route.fulfill({
      json: {
        taskId: businessId,
        title: 'Win with every crate',
        prizeKobo: '200000',
        prizes: 10,
        claimed: 2,
        issued: 10,
        availableToIssue: 0,
        promotionTerms: { prize: { item: 'A crate of Fizz' } },
        batches: [],
      },
    }),
  );
  const codes: string[] = [];
  await page.route(`**/api/v1/promotions/${businessId}/handovers`, (route) => {
    const { code } = route.request().postDataJSON();
    codes.push(code);
    return code.replace(/\s/g, '').toUpperCase() === 'ABCDEF123456'
      ? route.fulfill({
          json: {
            redemptionId: businessId,
            item: 'A crate of Fizz',
            handedOver: true,
          },
        })
      : route.fulfill({
          status: 409,
          json: { statusCode: 409, reason: 'voucher_unknown' },
        });
  });
  await page.goto(`/business/promotions/${businessId}`);
  await expect(page.getByText('Hand over a prize')).toBeVisible();
  await healthy(page);
  await page.getByLabel('Voucher code').fill('0000 0000 0000');
  await page.getByRole('button', { name: 'Confirm handover' }).click();
  await expect(page.getByText(/not valid for this promotion/)).toBeVisible();
  await page.getByLabel('Voucher code').fill('abcd ef12 3456');
  await page.getByRole('button', { name: 'Confirm handover' }).click();
  await expect(page.getByText('Hand over A crate of Fizz now.')).toBeVisible();
  expect(codes).toEqual(['0000 0000 0000', 'abcd ef12 3456']);
});

test('a reviewer freezes an account with a reason and can restore it', async ({
  page,
}) => {
  const accountId = '3e1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
  let state = 'active';
  let locked = true;
  const history: Record<string, unknown>[] = [];
  const view = () => ({
    id: accountId,
    username: 'suspect',
    displayName: 'Suspect User',
    accessState: state,
    phoneVerified: true,
    business: false,
    withdrawalsLocked: locked,
    createdAt: '2026-10-01T12:00:00Z',
    history,
  });
  await page.route('**/api/v1/admin/accounts?*', (route) =>
    route.fulfill({ json: view() }),
  );
  const bodies: Record<string, unknown>[] = [];
  await page.route(`**/api/v1/admin/accounts/${accountId}/access`, (route) => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    history.unshift({
      fromState: state,
      toState: body.toState,
      reason: body.reason,
      by: 'reviewer',
      at: '2026-10-05T12:00:00Z',
    });
    // The reviewer who froze it cannot unfreeze it alone.
    if (body.toState === 'active')
      return route.fulfill({
        status: 409,
        json: { statusCode: 409, reason: 'access_change_unavailable' },
      });
    state = body.toState;
    return route.fulfill({ json: view() });
  });
  await page.route(
    `**/api/v1/admin/accounts/${accountId}/withdrawal-unlocks`,
    (route) => {
      locked = false;
      return route.fulfill({ json: view() });
    },
  );
  await page.goto('/review/accounts');
  await page.getByLabel('Username').fill('@suspect');
  await page.getByRole('button', { name: 'Find account' }).click();
  await expect(page.getByText('Suspect User')).toBeVisible();
  await healthy(page);
  await page.getByRole('button', { name: 'Freeze account' }).click();
  await expect(page.getByText(/Write the reason/)).toBeVisible();
  expect(bodies).toHaveLength(0);
  await page.getByLabel('Reason').fill('Twelve accounts on one device');
  await page.getByRole('button', { name: 'Freeze account' }).click();
  await expect(page.getByText('Frozen', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Frozen: Twelve accounts on one device'),
  ).toBeVisible();
  expect(bodies[0]).toMatchObject({
    toState: 'suspended',
    reason: 'Twelve accounts on one device',
  });
  await page.getByLabel('Reason').fill('Explained');
  await page.getByRole('button', { name: 'Unfreeze account' }).click();
  await expect(page.getByText(/Another reviewer must unfreeze/)).toBeVisible();

  await expect(
    page.getByText(/Withdrawals locked by the account owner/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Unlock withdrawals' }).click();
  await page.getByRole('button', { name: 'Yes, I checked: unlock' }).click();
  await expect(
    page.getByText(/Withdrawals locked by the account owner/),
  ).toBeHidden();
});

test('a reviewer decides a void dispute with a reason, and the shopper can be paid', async ({
  page,
}) => {
  const disputeId = '5d1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
  let decided = false;
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/v1/admin/disputes', (route) =>
    route.fulfill({
      json: {
        items: decided
          ? []
          : [
              {
                id: disputeId,
                title: 'Lunch cash back',
                business: 'Mama Put Kitchen',
                shopper: 'ada',
                amountKobo: '450000',
                cashbackKobo: '50000',
                purchasedAt: '2026-10-04T12:00:00Z',
                voidReason: 'Refunded at the counter',
                voidedAt: '2026-10-04T15:00:00Z',
                note: 'Rice and chicken, receipt 0412',
                disputedAt: '2026-10-05T09:00:00Z',
                campaignConfirmed: 40,
                campaignVoided: 8,
              },
            ],
      },
    }),
  );
  await page.route(`**/api/v1/admin/disputes/${disputeId}/rulings`, (route) => {
    bodies.push(route.request().postDataJSON());
    decided = true;
    return route.fulfill({ json: { id: disputeId, decision: 'reversed' } });
  });
  await page.goto('/review/disputes');
  await expect(page.getByText('Rice and chicken, receipt 0412')).toBeVisible();
  await expect(page.getByText('8 of 40 purchases (20%)')).toBeVisible();
  await healthy(page);
  await page.getByRole('button', { name: 'Pay the shopper' }).click();
  await expect(page.getByText(/Write the reason/)).toBeVisible();
  expect(bodies).toHaveLength(0);
  await page.getByLabel('Reason').fill('Receipt matches the till record.');
  await page.getByRole('button', { name: 'Pay the shopper' }).click();
  await expect(page.getByText(/The shopper has been paid/)).toBeVisible();
  await expect(page.getByText('No disputes waiting.')).toBeVisible();
  expect(bodies[0]).toEqual({
    decision: 'reversed',
    reason: 'Receipt matches the till record.',
  });
});

test('flagged payments take a note and then show it', async ({ page }) => {
  const eventId = '4f1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
  let review: Record<string, unknown> | null = null;
  await page.route('**/api/v1/admin/payments/flagged', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: eventId,
            provider: 'bachs',
            eventId: 'evt_991',
            type: 'collection.succeeded',
            reference: null,
            amountKobo: '400000',
            currency: 'NGN',
            outcome: 'unknown_reference',
            receivedAt: '2026-10-05T12:00:00Z',
            review,
          },
        ],
      },
    }),
  );
  await page.route(
    `**/api/v1/admin/payments/events/${eventId}/reviews`,
    (route) => {
      review = {
        note: route.request().postDataJSON().note,
        at: '2026-10-05T13:00:00Z',
      };
      return route.fulfill({ json: { eventId, reviewed: true } });
    },
  );
  await page.goto('/review/payments');
  await expect(page.getByText('No matching request')).toBeVisible();
  await healthy(page);
  await page
    .getByLabel('What you found and did')
    .fill('Refunded by the provider.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByText(/Refunded by the provider\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save note' })).toHaveCount(0);
});

test('business sign up has its own page and only owners see the business button', async ({
  page,
}) => {
  await page.goto('/signup?as=business');
  await expect(
    page.getByRole('heading', { name: 'Create your business account' }),
  ).toBeVisible();
  await expect(page.getByText('Add your business').first()).toBeVisible();

  let owner = false;
  await page.route('**/api/v1/sponsor/profile', (route) =>
    owner
      ? route.fulfill({ json: { id: businessId, name: 'Mama Put Kitchen' } })
      : route.fulfill({ status: 404, json: { statusCode: 404 } }),
  );
  await page.route('**/api/v1/staff/workplaces', (route) =>
    route.fulfill({ json: { items: [], invitations: [] } }),
  );
  await page.goto('/offers');
  await expect(page.getByRole('heading', { name: 'Offers' })).toBeVisible();
  // A personal account has no business tools in its header.
  await expect(page.getByRole('link', { name: 'My business' })).toHaveCount(0);
  owner = true;
  await page.reload();
  await expect(page.getByRole('link', { name: 'My business' })).toHaveAttribute(
    'href',
    '/business',
  );
});

test('on a phone the business has a tab bar, a More sheet and a quick confirm', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const offer = (id: string, title: string) => ({
    id,
    title,
    model: 'purchase_cashback',
    capacity: 40,
    used: 4,
    reviewState: 'approved',
    lifecycle: 'published',
    endsAt: '2099-12-10T18:00:00Z',
    rewardKobo: '50000',
  });
  const second = '6c1f9e5f-2d3b-4f8b-8a4c-3e7d9b2f5a81';
  let campaigns = [offer(businessId, 'Lunch cash back')];
  await page.route('**/api/v1/business/overview?*', (route) =>
    route.fulfill({ json: overview(campaigns) }),
  );

  await page.goto('/business');
  const bar = page.getByRole('navigation', { name: 'Business sections' });
  for (const name of ['Home', 'Offers', 'Confirm', 'Funds', 'More'])
    await expect(bar.getByText(name, { exact: true })).toBeVisible();
  await bar.getByRole('button', { name: 'More' }).click();
  const sheet = page.getByRole('dialog', { name: 'More business tools' });
  await expect(
    sheet.getByRole('link', { name: 'Switch to personal' }),
  ).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Staff' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  // One live offer: Confirm opens its scanner straight away.
  await bar.getByRole('link', { name: 'Confirm' }).click();
  await page.waitForURL(`**/business/campaigns/${businessId}`);

  // Several: pick which one the customer bought under.
  campaigns = [
    offer(businessId, 'Lunch cash back'),
    offer(second, 'Weekend cash back'),
  ];
  await page.goto('/business/confirm');
  await expect(
    page.getByRole('heading', { name: 'Which offer did they buy under?' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Weekend cash back/ }),
  ).toHaveAttribute('href', `/business/campaigns/${second}`);
  await healthy(page);

  // None live: explains how to start.
  campaigns = [];
  await page.reload();
  await expect(
    page.getByRole('link', { name: 'Create a cash back offer' }),
  ).toBeVisible();
});
