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
    },
  });
});

test('a chance promotion requires the state permit; every-code-wins does not', async ({
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
  await page.getByRole('button', { name: 'Some codes win' }).click();
  await page.getByRole('button', { name: 'Lock ₦20,000 and submit' }).click();
  await expect(page.getByText('Enter your permit number.')).toBeVisible();
  expect(bodies).toHaveLength(0);
  await page.getByLabel('Permit issued by').fill('LSLGA');
  await page.getByLabel('Permit number').fill('LG-2026-118');
  await healthy(page);
  await page.getByRole('button', { name: 'Lock ₦20,000 and submit' }).click();
  await page.waitForURL('**/business/promotions?created=1');
  expect(bodies[0]).toMatchObject({
    model: 'claim_code',
    rewardKobo: '500000',
    promotionTerms: {
      mode: 'chance',
      permit: { authority: 'LSLGA', number: 'LG-2026-118' },
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

test('an owner adds and removes till staff, and staff see their tills', async ({
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
  await page.getByRole('button', { name: 'Add to staff' }).click();
  await expect(page.getByText(/No active Acticlaim account/)).toBeVisible();
  await page.getByLabel('Their Acticlaim username').fill('@ada');
  await page.getByRole('button', { name: 'Add to staff' }).click();
  await expect(page.getByText('Ada Obi')).toBeVisible();
  await page.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(page.getByText('No staff yet.')).toBeVisible();

  await page.route('**/api/v1/staff/workplaces', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: businessId,
            name: 'Mama Put Kitchen',
            tills: [{ id: businessId, title: 'Lunch cash back' }],
          },
        ],
      },
    }),
  );
  await page.goto('/staff');
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
  const history: Record<string, unknown>[] = [];
  const view = () => ({
    id: accountId,
    username: 'suspect',
    displayName: 'Suspect User',
    accessState: state,
    phoneVerified: true,
    business: false,
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
    state = body.toState;
    return route.fulfill({ json: view() });
  });
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
