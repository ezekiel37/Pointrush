import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const offerId = '5b0f8d4e-1c2a-4e7a-9f3b-2d6c8a1e4f70';
const purchaseId = '7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const offer = {
  id: offerId,
  title: 'Lunch cash back',
  businessName: 'Mama Put Kitchen',
  startsAt: '2026-10-01T09:00:00Z',
  endsAt: '2026-12-10T18:00:00Z',
  capacity: 100,
  claimed: 38,
  rewardBackingKobo: '50000',
  model: 'purchase_cashback',
  campaignTerms: {
    minSpendKobo: '300000',
    holdHours: 72,
    placeName: 'Mama Put Kitchen',
    placeAddress: '12 Campus Road, Ibadan',
  },
};

function overview(days: number) {
  return {
    business: { id: offerId, name: 'Mama Put Kitchen' },
    days,
    series: Array.from({ length: days }, (_, i) => ({
      day: new Date(Date.UTC(2026, 9, 5 - (days - 1 - i)))
        .toISOString()
        .slice(0, 10),
      purchases: i === days - 1 ? 12 : i % 5,
      claims: 0,
    })),
    purchases: {
      held: 12,
      ready: 4,
      paid: 20,
      voided: 1,
      returningShoppers: 9,
    },
    customers: {
      total: 31,
      thisMonth: 14,
      new: 5,
      returning: 9,
      regular: 6,
      longTerm: 2,
      slippingAway: 3,
    },
    availableKobo: '2500000',
    lockedKobo: '6450000',
    paidOutKobo: '1500000',
    live: 1,
    campaigns: [
      {
        id: offerId,
        title: 'Lunch cash back',
        model: 'purchase_cashback',
        capacity: 100,
        used: 37,
        reviewState: 'approved',
        lifecycle: 'published',
        endsAt: '2026-12-10T18:00:00Z',
        rewardKobo: '50000',
      },
    ],
  };
}

async function phone(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
}
async function healthy(page: Page) {
  // Measure the settled page: wait for time-based entrance animations (not
  // looping or scroll-driven ones) so contrast is not read mid-fade.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.timeline === document.timeline &&
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test('landing explains the product and leads to offers and claims', async ({
  page,
}) => {
  await phone(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Get paid',
  );
  await expect(page.getByRole('link', { name: 'Start earning' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Claim a prize code' }),
  ).toHaveAttribute('href', '/login?next=/claim');
  await healthy(page);
});

test('offer ticket shows a scannable single-use code that survives a reload offline', async ({
  page,
}) => {
  await phone(page);
  let issued = 0;
  await page.route('**/api/v1/work/tasks?*', (route) =>
    route.fulfill({ json: { items: [offer], nextCursor: null } }),
  );
  await page.route(`**/api/v1/work/tasks/${offerId}`, (route) =>
    route.fulfill({
      json: { ...offer, instructions: 'Buy any meal and show your code.' },
    }),
  );
  await page.route(`**/api/v1/campaigns/${offerId}/codes`, (route) => {
    issued++;
    return route.fulfill({
      json: {
        taskId: offerId,
        code: '7K4M2PRDH9',
        display: '7K4M2-PRDH9',
        expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
      },
    });
  });
  await page.goto('/offers');
  await expect(page.getByText('62 left')).toBeVisible();
  await expect(page.getByText('₦500', { exact: true })).toBeVisible();
  await healthy(page);
  await page.getByRole('link', { name: /Lunch cash back/ }).click();
  await page.getByRole('button', { name: 'Get my code' }).click();
  await expect(page.getByText('7K4M2-PRDH9')).toBeVisible();
  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
  await expect(page.getByRole('timer')).toContainText('Valid for 1');
  await healthy(page);
  expect(issued).toBe(1);
  // The live code is kept on the device: it still shows when the API fails.
  await page.unroute(`**/api/v1/work/tasks/${offerId}`);
  await page.route(`**/api/v1/work/tasks/${offerId}`, (route) => route.abort());
  await page.reload();
  await expect(page.getByText('7K4M2-PRDH9')).toBeVisible();
  expect(issued).toBe(1);
});

test('prize claim keeps its identity across a dropped response and reveals the prize', async ({
  page,
}) => {
  await phone(page);
  const bodies: { id: string; code: string }[] = [];
  let drop = true;
  await page.route('**/api/v1/claims?*', (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route('**/api/v1/claims', async (route) => {
    bodies.push(route.request().postDataJSON());
    if (drop) {
      drop = false;
      return route.abort('connectionreset');
    }
    return route.fulfill({
      json: {
        id: bodies[0]!.id,
        taskId: offerId,
        title: 'Scratch and win',
        businessName: 'Fizz Drinks',
        prizeKobo: '500000',
        claimedAt: new Date().toISOString(),
      },
    });
  });
  await page.goto('/claim?code=AC-7K4M-9X2Q-PRDH-3VBN');
  await expect(page.getByLabel('Prize code')).toHaveValue(
    'AC-7K4M-9X2Q-PRDH-3VBN',
  );
  await healthy(page);
  await page.getByRole('button', { name: 'Claim prize' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'never claim twice',
  );
  await page.getByRole('button', { name: 'Claim prize' }).click();
  await expect(page.getByText('₦5,000', { exact: true })).toBeVisible();
  await expect(
    page.getByText('The money is in your Acticlaim wallet.'),
  ).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]!.id).toBe(bodies[0]!.id);
  await healthy(page);
});

test('a rejected code explains itself without revealing whether it exists', async ({
  page,
}) => {
  await phone(page);
  await page.route('**/api/v1/claims?*', (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route('**/api/v1/claims', (route) =>
    route.fulfill({
      status: 409,
      json: { statusCode: 409, message: 'x', reason: 'claim_rejected' },
    }),
  );
  await page.goto('/claim');
  await page.getByLabel('Prize code').fill('AC-AAAA-BBBB-CCCC-DDDD');
  await page.getByRole('button', { name: 'Claim prize' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'cannot be claimed',
  );
});

test('wallet separates paid money from held cash back and releases once', async ({
  page,
}) => {
  await phone(page);
  let released = 0;
  const items = [
    {
      id: purchaseId,
      taskId: offerId,
      title: 'Lunch cash back',
      businessName: 'Mama Put Kitchen',
      amountKobo: '450000',
      cashbackKobo: '50000',
      releaseAt: '2026-10-03T12:00:00Z',
      createdAt: '2026-10-01T12:00:00Z',
      state: 'releasable',
    },
    {
      id: 'aa1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
      taskId: offerId,
      title: 'Lunch cash back',
      businessName: 'Suya Spot',
      amountKobo: '300000',
      cashbackKobo: '20000',
      releaseAt: '2026-12-01T12:00:00Z',
      createdAt: '2026-11-28T12:00:00Z',
      state: 'pending',
    },
  ];
  await page.route('**/api/v1/points', (route) =>
    route.fulfill({
      json: {
        points: { available: '120', pending: '50' },
        walletKobo: released ? '150000' : '100000',
        tier: {
          name: 'New',
          businesses: 2,
          next: { name: 'Bronze', businesses: 3 },
        },
        phoneVerified: true,
        referral: {
          code: 'ada_earns',
          referredBy: null,
          referred: 0,
          rewarded: 0,
        },
      },
    }),
  );
  await page.route('**/api/v1/purchases?*', (route) =>
    route.fulfill({
      json: {
        items: released
          ? [{ ...items[0], state: 'released' }, items[1]]
          : items,
        nextCursor: null,
        observedAt: '2026-10-04T12:00:00Z',
      },
    }),
  );
  await page.route(`**/api/v1/purchases/${purchaseId}/releases`, (route) => {
    released++;
    return route.fulfill({
      json: {
        confirmationId: purchaseId,
        state: 'released',
        cashbackKobo: '50000',
      },
    });
  });
  await page.route('**/api/v1/wallet/withdrawals?*', (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.goto('/wallet');
  await expect(page.getByText('₦1,000', { exact: true })).toBeVisible();
  // Held money shows its own total and a label, never as wallet money.
  await expect(page.getByText('₦700 cash back on hold')).toBeVisible();
  await expect(page.getByText('Held', { exact: true })).toBeVisible();
  await healthy(page);
  await page.getByRole('button', { name: 'Move to wallet' }).click();
  await expect(page.getByText('₦1,500', { exact: true })).toBeVisible();
  await expect(page.getByText('In wallet', { exact: true })).toBeVisible();
  expect(released).toBe(1);
});

test('a shopper disputes a void within 7 days and sees it waiting for a reviewer', async ({
  page,
}) => {
  await phone(page);
  let disputed = false;
  const notes: string[] = [];
  await page.route('**/api/v1/points', (route) =>
    route.fulfill({
      json: {
        points: { available: '0', pending: '0' },
        walletKobo: '0',
        tier: {
          name: 'New',
          businesses: 1,
          next: { name: 'Bronze', businesses: 3 },
        },
        phoneVerified: false,
        referral: { code: null, referredBy: null, referred: 0, rewarded: 0 },
      },
    }),
  );
  await page.route('**/api/v1/purchases?*', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: purchaseId,
            taskId: offerId,
            title: 'Lunch cash back',
            businessName: 'Mama Put Kitchen',
            amountKobo: '450000',
            cashbackKobo: '50000',
            releaseAt: '2026-10-07T12:00:00Z',
            createdAt: '2026-10-04T12:00:00Z',
            state: 'voided',
            voidReason: 'Refunded at the counter',
            disputeUntil: disputed ? null : '2026-10-11T12:00:00Z',
            dispute: disputed ? 'open' : null,
          },
        ],
        nextCursor: null,
        observedAt: '2026-10-05T12:00:00Z',
      },
    }),
  );
  await page.route(`**/api/v1/purchases/${purchaseId}/disputes`, (route) => {
    notes.push(route.request().postDataJSON().note);
    disputed = true;
    return route.fulfill({ json: { confirmationId: purchaseId } });
  });
  await page.route('**/api/v1/wallet/withdrawals?*', (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.goto('/wallet');
  await expect(
    page.getByText("Business's reason: Refunded at the counter"),
  ).toBeVisible();
  await healthy(page);
  await page.getByRole('button', { name: 'This was a real purchase' }).click();
  await page.getByRole('button', { name: 'Send dispute' }).click();
  await expect(page.getByText(/Say what you bought/)).toBeVisible();
  await page
    .getByLabel(/What did you buy/)
    .fill('Rice and chicken, receipt 0412');
  await page.getByRole('button', { name: 'Send dispute' }).click();
  await expect(
    page.getByText(/A reviewer is checking your dispute/),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'This was a real purchase' }),
  ).toHaveCount(0);
  expect(notes).toEqual(['Rice and chicken, receipt 0412']);
});

test('till confirms a typed code with exact kobo and replays an uncertain confirmation', async ({
  page,
}) => {
  await phone(page);
  const bodies: { id: string; code: string; amountKobo: string }[] = [];
  let drop = true;
  const summary = {
    taskId: offerId,
    title: 'Lunch cash back',
    capacity: 100,
    cashbackKobo: '50000',
    budgetKobo: '5000000',
    campaignTerms: offer.campaignTerms,
    confirmed: 38,
    voided: 1,
    released: 20,
    remaining: 63,
    returningShoppers: 9,
    recent: { items: [], nextCursor: null, observedAt: '2026-10-04T12:00:00Z' },
  };
  await page.route(`**/api/v1/campaigns/${offerId}/summary?*`, (route) =>
    route.fulfill({ json: summary }),
  );
  await page.route(
    `**/api/v1/campaigns/${offerId}/confirmations`,
    async (route) => {
      bodies.push(route.request().postDataJSON());
      if (drop) {
        drop = false;
        return route.abort('connectionreset');
      }
      return route.fulfill({
        json: {
          id: bodies[0]!.id,
          taskId: offerId,
          amountKobo: '450050',
          cashbackKobo: '50000',
          releaseAt: '2026-10-07T12:00:00Z',
          createdAt: '2026-10-04T12:00:00Z',
        },
      });
    },
  );
  await page.goto(`/business/campaigns/${offerId}`);
  await expect(page.getByText('Came back')).toBeVisible();
  await healthy(page);
  await page.getByLabel("Shopper's code").fill('7k4m2-prdh9');
  await page.getByLabel('Amount paid (₦)').fill('4,500.5');
  await page.getByRole('button', { name: 'Confirm purchase' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'never records a purchase twice',
  );
  await page.getByRole('button', { name: 'Confirm purchase' }).click();
  await expect(page.getByText('Purchase confirmed.')).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toMatchObject({
    code: '7k4m2-prdh9',
    amountKobo: '450050',
  });
  expect(bodies[1]!.id).toBe(bodies[0]!.id);
});

test('voiding a purchase asks for a reason in a dialog', async ({ page }) => {
  await phone(page);
  const purchase = '7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e61';
  const reasons: string[] = [];
  await page.route(`**/api/v1/campaigns/${offerId}/summary?*`, (route) =>
    route.fulfill({
      json: {
        taskId: offerId,
        title: 'Lunch cash back',
        capacity: 100,
        cashbackKobo: '50000',
        budgetKobo: '5000000',
        campaignTerms: offer.campaignTerms,
        confirmed: 1,
        voided: 0,
        released: 0,
        remaining: 99,
        voidsLeft: 2,
        returningShoppers: 0,
        recent: {
          items: [
            {
              id: purchase,
              taskId: offerId,
              title: 'Lunch cash back',
              businessName: 'Mama Put Kitchen',
              amountKobo: '450000',
              cashbackKobo: '50000',
              payoutKobo: null,
              group: null,
              releaseAt: '2026-10-07T12:00:00Z',
              createdAt: '2026-10-04T12:00:00Z',
              state: reasons.length ? 'voided' : 'pending',
              voidReason: null,
              disputeUntil: null,
              dispute: null,
            },
          ],
          nextCursor: null,
          observedAt: '2026-10-04T12:00:00Z',
        },
      },
    }),
  );
  await page.route(`**/api/v1/purchases/${purchase}/voids`, (route) => {
    reasons.push(route.request().postDataJSON().reason);
    return route.fulfill({ json: { confirmationId: purchase } });
  });
  await page.goto(`/business/campaigns/${offerId}`);
  await page.getByRole('button', { name: 'Void' }).click();
  const dialog = page.getByRole('dialog', { name: 'Void this cash back?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Reason for voiding')).toBeFocused();
  await healthy(page);
  // Escape closes it without voiding.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(reasons).toHaveLength(0);

  await page.getByRole('button', { name: 'Void' }).click();
  await expect(
    dialog.getByRole('button', { name: 'Void cash back' }),
  ).toBeDisabled();
  await dialog.getByLabel('Reason for voiding').fill('Refunded at the counter');
  await dialog.getByRole('button', { name: 'Void cash back' }).click();
  await expect(page.getByText('Cash back voided')).toBeVisible();
  expect(reasons).toEqual(['Refunded at the counter']);
});

test('installable: manifest, icons and offline page are served', async ({
  page,
  request,
}) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'Acticlaim', display: 'standalone' });
  for (const icon of manifest.icons as { src: string }[])
    expect((await request.get(icon.src)).ok()).toBe(true);
  const worker = await request.get('/sw.js');
  expect(worker.headers()['cache-control']).toContain('no-cache');
  await page.goto('/offline');
  await expect(
    page.getByRole('heading', { name: 'You are offline' }),
  ).toBeVisible();
  await healthy(page);
});

test('business overview chart reads by keyboard, switches range and fits a phone', async ({
  page,
}) => {
  const ranges: string[] = [];
  await page.route('**/api/v1/business/overview?*', (route) => {
    const days = Number(
      new URL(route.request().url()).searchParams.get('days'),
    );
    ranges.push(String(days));
    return route.fulfill({ json: overview(days) });
  });
  await phone(page);
  await page.goto('/business');
  await expect(page.getByText('Mama Put Kitchen')).toBeHidden();
  await expect(page.getByText('Held in refund window')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Lunch cash back' }),
  ).toBeVisible();
  const loyalty = page.getByRole('region', { name: 'Your customers' });
  await expect(loyalty).toContainText('31 people have bought');
  await expect(loyalty.getByText('Regulars')).toBeVisible();
  await expect(loyalty).toContainText('Bring them back with a monthly offer');
  await healthy(page);
  const chart = page.getByRole('group', {
    name: /Confirmed purchases per day/,
  });
  await chart.focus();
  await page.keyboard.press('ArrowRight');
  await expect(chart.getByRole('status')).toContainText('12 purchases');
  await page.keyboard.press('ArrowLeft');
  await expect(chart.getByRole('status')).not.toContainText('12 purchases');
  await page.getByRole('button', { name: 'Last 30 days' }).click();
  await expect(page.getByText(/in the last 30 days/)).toBeVisible();
  // Development mode may request a range twice (strict effects); only the
  // two ranges are ever fetched, ending with the selected one.
  expect(new Set(ranges)).toEqual(new Set(['7', '30']));
  expect(ranges.at(-1)).toBe('30');
});

test('business funding goes to the provider checkout and reuses its ID after a dropped response', async ({
  page,
}) => {
  await phone(page);
  await page.route('**/api/v1/business/overview?*', (route) =>
    route.fulfill({ json: overview(7) }),
  );
  const bodies: { id: string; amountKobo: string }[] = [];
  await page.route('**/api/v1/payments/funding-intents', (route) => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    if (bodies.length === 1) return route.abort();
    return route.fulfill({
      json: {
        intentId: body.id,
        amountKobo: body.amountKobo,
        checkoutUrl: `https://payments.example.test/checkout/${body.id}`,
      },
    });
  });
  await page.route('https://payments.example.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<title>Checkout</title>',
    }),
  );
  await page.goto('/business/funds');
  await expect(page.getByText('₦25,000', { exact: true })).toBeVisible();
  await healthy(page);
  await page
    .getByRole('button', { name: 'Continue to secure checkout' })
    .click();
  await expect(page.getByText('Enter an amount between')).toBeVisible();
  await page.getByRole('button', { name: '₦100,000' }).click();
  await page.getByRole('button', { name: 'Continue to pay ₦100,000' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'you will not be charged twice',
  );
  await page.getByRole('button', { name: 'Continue to pay ₦100,000' }).click();
  await page.waitForURL('https://payments.example.test/checkout/**');
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0]?.amountKobo).toBe('10000000');
});

test('a withdrawal holds money once across a dropped response and shows its state', async ({
  page,
}) => {
  await phone(page);
  let held = false;
  const summary = (phoneVerified: boolean) => ({
    points: { available: '0', pending: '0' },
    walletKobo: held ? '80000' : '200000',
    tier: {
      name: 'New',
      businesses: 1,
      next: { name: 'Bronze', businesses: 3 },
    },
    phoneVerified,
    referral: { code: null, referredBy: null, referred: 0, rewarded: 0 },
  });
  let verified = false;
  await page.route('**/api/v1/points', (route) =>
    route.fulfill({ json: summary(verified) }),
  );
  await page.route('**/api/v1/purchases?*', (route) =>
    route.fulfill({
      json: { items: [], nextCursor: null, observedAt: '2026-10-05T12:00:00Z' },
    }),
  );
  const bodies: { id: string; amountKobo: string; password?: string }[] = [];
  let locked = false;
  await page.route('**/api/v1/wallet/withdrawals*', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          items: held
            ? [
                {
                  id: bodies[0]!.id,
                  amountKobo: '120000',
                  createdAt: '2026-10-05T12:00:00Z',
                  state: 'held',
                },
              ]
            : [],
          nextCursor: null,
        },
      });
    const body = route.request().postDataJSON();
    if (body.password !== 'correct horse battery')
      return route.fulfill({
        status: 409,
        json: { statusCode: 409, reason: 'password_required' },
      });
    bodies.push(body);
    if (bodies.length === 1) return route.abort();
    held = true;
    return route.fulfill({
      json: {
        id: body.id,
        amountKobo: body.amountKobo,
        createdAt: '2026-10-05T12:00:00Z',
        state: 'held',
      },
    });
  });

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
        locked,
      },
    }),
  );
  await page.route('**/api/v1/wallet/lock', (route) => {
    locked = true;
    return route.fulfill({ json: { locked: true } });
  });
  // Without a verified phone the withdraw action is disabled with the reason.
  await page.goto('/wallet');
  await expect(page.getByText(/needs a verified phone number/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Withdraw', exact: true }),
  ).toHaveAttribute('aria-disabled', 'true');

  verified = true;
  await page.reload();
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await expect(
    page.getByText('To ADA OKAFOR, Guaranty Trust Bank ••••6789'),
  ).toBeVisible();
  await page.getByLabel('Amount in naira').fill('3000');
  await page.getByRole('button', { name: 'Withdraw ₦3,000' }).click();
  await expect(page.getByText('You have ₦2,000 in your wallet.')).toBeVisible();
  await page.getByLabel('Amount in naira').fill('1,200');
  // The password is asked again, and a wrong one is cleared.
  await page.getByRole('button', { name: 'Withdraw ₦1,200' }).click();
  await expect(
    page.getByText('Enter your password to confirm it is you.'),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Your password' }).fill('guess');
  await page.getByRole('button', { name: 'Withdraw ₦1,200' }).click();
  await expect(page.getByText(/That password is not right/)).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Your password' }),
  ).toHaveValue('');
  await page
    .getByRole('textbox', { name: 'Your password' })
    .fill('correct horse battery');
  await healthy(page);
  await page.getByRole('button', { name: 'Withdraw ₦1,200' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'never be taken twice',
  );
  await page.getByRole('button', { name: 'Withdraw ₦1,200' }).click();
  await expect(page.getByText(/is on its way/)).toBeVisible();
  await expect(page.getByText('Processing', { exact: true })).toBeVisible();
  await expect(page.getByText('₦800', { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0]?.amountKobo).toBe('120000');

  // "This wasn't me" asks once more, then locks withdrawals.
  await page.getByRole('button', { name: "This wasn't me" }).click();
  await page.getByRole('button', { name: 'Yes, lock withdrawals' }).click();
  await expect(
    page.getByRole('status', { name: 'Withdrawals locked' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Withdraw', exact: true }),
  ).toHaveAttribute('aria-disabled', 'true');
  await expect(
    page.getByText('Withdrawals are locked while support checks your account.'),
  ).toBeVisible();
  await healthy(page);
});

test('phone verification sends a code, explains a wrong one and returns to the next page', async ({
  page,
}) => {
  await phone(page);
  const challengeId = '9a1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
  await page.route('**/api/v1/phone', (route) =>
    route.fulfill({ json: { verified: false, phone: null } }),
  );
  const sent: unknown[] = [];
  await page.route('**/api/v1/phone/challenges', (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        challengeId,
        phone: '+234 ••• 4567',
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        resendAt: new Date(Date.now() + 60000).toISOString(),
      },
    });
  });
  await page.route('**/api/v1/phone/verifications', (route) => {
    const body = route.request().postDataJSON();
    return body.code === '123456'
      ? route.fulfill({ json: { verified: true, phone: '+234 ••• 4567' } })
      : route.fulfill({
          status: 409,
          json: { statusCode: 409, reason: 'code_wrong' },
        });
  });
  await page.route('**/api/v1/points', (route) =>
    route.fulfill({ status: 401, json: { statusCode: 401 } }),
  );
  await page.goto('/verify-phone?next=/claim');
  await healthy(page);
  await page.getByLabel('Mobile number').fill('0803 123 4567');
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByText('+234 ••• 4567')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Send again in/ }),
  ).toBeDisabled();
  expect(sent).toEqual([{ phoneNumber: '0803 123 4567' }]);
  await page.getByLabel('6-digit code').fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('That code is not right.')).toBeVisible();
  await page.getByLabel('6-digit code').fill('123456');
  await healthy(page);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('+234 ••• 4567 is verified')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue' })).toHaveAttribute(
    'href',
    '/claim',
  );
});

test('the bell counts unread updates and opening them marks them read', async ({
  page,
}) => {
  await phone(page);
  let seen = 0;
  const feed = () => ({
    items: [
      {
        id: 'cashback_ready:1',
        kind: 'cashback_ready',
        at: '2026-10-05T12:00:00Z',
        unread: seen === 0,
        title: '₦500 cash back is ready',
        body: 'From Mama Put Kitchen. Move it to your wallet.',
        href: '/wallet',
      },
    ],
    unread: seen === 0 ? 1 : 0,
  });
  await page.route('**/api/v1/notifications', (route) =>
    route.fulfill({ json: feed() }),
  );
  await page.route('**/api/v1/notifications/seen', (route) => {
    seen++;
    return route.fulfill({ json: { unread: 0 } });
  });
  await page.route('**/api/v1/work/tasks?*', (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.goto('/offers');
  await page.getByRole('link', { name: 'Notifications, 1 unread' }).click();
  await expect(page.getByText('₦500 cash back is ready')).toBeVisible();
  await healthy(page);
  await expect.poll(() => seen).toBe(1);
  await page.goto('/offers');
  await expect(
    page.getByRole('link', { name: 'Notifications, none unread' }),
  ).toBeVisible();
});

test('an item prize shows a private voucher and offers its cash value after 14 days', async ({
  page,
}) => {
  await phone(page);
  const claimId = '8b1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
  const oldId = '9c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
  let cashed = false;
  const old = () => ({
    id: oldId,
    taskId: offerId,
    title: 'Scratch and win',
    businessName: 'Fizz Drinks',
    prizeKobo: '200000',
    claimedAt: '2026-09-01T12:00:00Z',
    prizeItem: 'Branded umbrella',
    voucherCode: 'ABCDEF123456',
    voucherState: cashed ? 'cashed_out' : 'awaiting',
    cashAvailableAt: '2026-09-15T12:00:00Z',
  });
  await page.route('**/api/v1/claims?*', (route) =>
    route.fulfill({ json: { items: [old()], nextCursor: null } }),
  );
  await page.route('**/api/v1/claims', (route) =>
    route.fulfill({
      json: {
        id: claimId,
        taskId: offerId,
        title: 'Scratch and win',
        businessName: 'Fizz Drinks',
        prizeKobo: '500000',
        claimedAt: new Date().toISOString(),
        prizeItem: 'A crate of Fizz',
        voucherCode: '0F1E2D3C4B5A',
        voucherState: 'awaiting',
        cashAvailableAt: new Date(Date.now() + 14 * 86400000).toISOString(),
      },
    }),
  );
  let cashOuts = 0;
  await page.route(`**/api/v1/claims/${oldId}/cash-outs`, (route) => {
    cashOuts++;
    cashed = true;
    return route.fulfill({ json: { redemptionId: oldId, cashedOut: true } });
  });
  await page.goto('/claim');
  // An older uncollected voucher stays reachable, with its cash option.
  await expect(page.getByText('Vouchers to collect')).toBeVisible();
  await expect(page.getByText('ABCD EF12 3456')).toBeVisible();
  await healthy(page);
  await page.getByLabel('Prize code').fill('AC-7K4M-9X2Q-PRDH-3VBN');
  await page.getByRole('button', { name: 'Claim prize' }).click();
  await expect(page.getByText('You won A crate of Fizz.')).toBeVisible();
  await expect(page.getByText('0F1E 2D3C 4B5A')).toBeVisible();
  await expect(page.getByText(/is locked for you/)).toBeVisible();
  await page.getByRole('button', { name: 'Take ₦2,000 instead' }).click();
  await expect(page.getByText('Paid as cash')).toBeVisible();
  expect(cashOuts).toBe(1);
});

test('a bank account is checked with the bank before withdrawals go to it', async ({
  page,
}) => {
  await phone(page);
  let saved: Record<string, unknown> | null = null;
  await page.route('**/api/v1/points', (route) =>
    route.fulfill({
      json: {
        points: { available: '0', pending: '0' },
        walletKobo: '200000',
        tier: {
          name: 'New',
          businesses: 1,
          next: { name: 'Bronze', businesses: 3 },
        },
        phoneVerified: true,
        referral: { code: null, referredBy: null, referred: 0, rewarded: 0 },
      },
    }),
  );
  await page.route('**/api/v1/purchases?*', (route) =>
    route.fulfill({
      json: { items: [], nextCursor: null, observedAt: '2026-10-05T12:00:00Z' },
    }),
  );
  await page.route('**/api/v1/wallet/withdrawals?*', (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route('**/api/v1/wallet/banks', (route) =>
    route.fulfill({
      json: {
        items: [
          { code: '044', name: 'Access Bank' },
          { code: '058', name: 'Guaranty Trust Bank' },
        ],
      },
    }),
  );
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/v1/wallet/bank-account', (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      bodies.push(body);
      if (body.accountNumber === '0123450000')
        return route.fulfill({
          status: 409,
          json: { statusCode: 409, reason: 'account_not_found' },
        });
      saved = {
        id: '6a1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
        bankName: 'Guaranty Trust Bank',
        accountName: 'ADA OKAFOR',
        last4: '6789',
        usableFrom: '2026-01-01T00:00:00Z',
      };
    }
    return route.fulfill({ json: { destination: saved } });
  });
  await page.goto('/wallet');
  await expect(
    page.getByText('Add a bank account below to withdraw.'),
  ).toBeVisible();
  const withdraw = page.getByRole('button', { name: 'Withdraw', exact: true });
  await expect(withdraw).toHaveAttribute('aria-disabled', 'true');
  // Tapping it explains why instead of opening the form.
  await withdraw.dispatchEvent('click');
  await expect(page.locator('#withdraw-panel')).toHaveCount(0);
  await expect(
    page.getByText('Add a bank account below to withdraw.'),
  ).toHaveCount(2);
  await healthy(page);
  await page.getByLabel('Bank', { exact: true }).selectOption('058');
  await page.getByLabel('Account number').fill('0123450000');
  await page.getByRole('button', { name: 'Check and save' }).click();
  await expect(page.getByText(/could not find this account/)).toBeVisible();
  await page.getByLabel('Account number').fill('0123456789');
  await page.getByRole('button', { name: 'Check and save' }).click();
  await expect(page.getByText('ADA OKAFOR')).toBeVisible();
  await expect(page.getByText('Guaranty Trust Bank ••••6789')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Withdraw', exact: true }),
  ).toHaveAttribute('aria-disabled', 'false');
  expect(bodies.at(-1)).toEqual({
    bankCode: '058',
    accountNumber: '0123456789',
  });
});

test('dark mode keeps every text colour readable', async ({ page }) => {
  await phone(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.route('**/api/v1/work/tasks?*', (route) =>
    route.fulfill({ json: { items: [offer], nextCursor: null } }),
  );
  await page.goto('/');
  await healthy(page);
  await page.goto('/offers');
  await expect(page.getByText('62 left')).toBeVisible();
  await healthy(page);
  await page.goto('/claim');
  await healthy(page);
});

test('wallet pays airtime and electricity once, with the password, and shows the token', async ({
  page,
}) => {
  await phone(page);
  let walletKobo = '200000';
  await page.route('**/api/v1/points', (route) =>
    route.fulfill({
      json: {
        points: { available: '0', pending: '0' },
        walletKobo,
        tier: {
          name: 'New',
          businesses: 1,
          next: { name: 'Bronze', businesses: 3 },
        },
        phoneVerified: true,
        referral: { code: null, referredBy: null, referred: 0, rewarded: 0 },
      },
    }),
  );
  await page.route('**/api/v1/wallet/bills/options', (route) =>
    route.fulfill({
      json: {
        available: true,
        minKobo: '5000',
        maxKobo: '5000000',
        billers: [
          { id: 'mtn', kind: 'airtime', name: 'MTN', plans: null },
          { id: 'airtel', kind: 'airtime', name: 'Airtel', plans: null },
          {
            id: 'mtn-data',
            kind: 'data',
            name: 'MTN',
            plans: [
              { code: 'mtn-1gb-1d', name: '1GB, 1 day', amountKobo: '35000' },
            ],
          },
          {
            id: 'ikedc',
            kind: 'electricity',
            name: 'Ikeja Electric (prepaid)',
            plans: null,
          },
          { id: 'dstv', kind: 'tv', name: 'DStv', plans: [] },
        ],
      },
    }),
  );
  await page.route('**/api/v1/wallet/bills/verify', (route) =>
    route.fulfill({ json: { name: 'ADA OKAFOR' } }),
  );
  const bodies: Record<string, string>[] = [];
  const done: Record<string, unknown>[] = [];
  await page.route('**/api/v1/wallet/bills?*', (route) =>
    route.fulfill({ json: { items: done, nextCursor: null } }),
  );
  await page.route('**/api/v1/wallet/bills', (route) => {
    const body = route.request().postDataJSON();
    if (body.password !== 'correct horse battery')
      return route.fulfill({
        status: 409,
        json: { statusCode: 409, reason: 'password_required' },
      });
    bodies.push(body);
    // The first response is lost; the retry reuses the same ID.
    if (bodies.length === 1) return route.abort();
    const result = {
      id: body.id,
      kind: body.kind,
      biller: body.biller,
      customerRef: body.customerRef,
      planCode: body.planCode ?? null,
      amountKobo: body.amountKobo,
      createdAt: '2026-10-09T12:00:00Z',
      state: 'delivered',
      token: body.kind === 'electricity' ? '1234-5678-9012-3456-7890' : null,
      failure: null,
    };
    done.unshift(result);
    walletKobo = String(BigInt(walletKobo) - BigInt(body.amountKobo));
    return route.fulfill({ json: result });
  });

  await page.goto('/wallet');
  await page.getByRole('link', { name: 'Airtime', exact: true }).click();
  await page.waitForURL('**/wallet/bills?kind=airtime');
  await expect(page.getByText('₦2,000')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/11-digit phone number/)).toBeVisible();
  await page.getByLabel('Phone number').fill('0803 123 4567');
  await page.getByLabel('Amount in naira').fill('500');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Check and pay')).toBeVisible();
  await healthy(page);
  await page.getByRole('button', { name: 'Pay ₦500' }).click();
  await expect(page.getByText(/Enter your password/)).toBeVisible();
  await page.getByLabel('Your password', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Pay ₦500' }).click();
  await expect(page.getByText('That password is not right.')).toBeVisible();
  await page
    .getByLabel('Your password', { exact: true })
    .fill('correct horse battery');
  await page.getByRole('button', { name: 'Pay ₦500' }).click();
  await expect(page.getByText(/never be charged twice/)).toBeVisible();
  await page.getByRole('button', { name: 'Pay ₦500' }).click();
  await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]!.id).toBe(bodies[1]!.id);
  expect(bodies[1]).toMatchObject({
    kind: 'airtime',
    biller: 'mtn',
    customerRef: '08031234567',
    amountKobo: '50000',
  });

  await page.getByRole('button', { name: 'Pay another' }).click();
  await page.getByRole('button', { name: 'Electricity' }).click();
  await page.getByLabel('Meter number').fill('45012345678');
  await page.getByLabel('Amount in naira').fill('1,000');
  await page.getByRole('button', { name: 'Check number' }).click();
  await expect(page.getByText('ADA OKAFOR')).toBeVisible();
  await page
    .getByLabel('Your password', { exact: true })
    .fill('correct horse battery');
  await page.getByRole('button', { name: 'Pay ₦1,000' }).click();
  await expect(page.getByText('1234-5678-9012-3456-7890')).toBeVisible();
  await healthy(page);
  await expect(page.getByText('Recent payments')).toBeVisible();
});

test('bills show coming soon until a provider is connected', async ({
  page,
}) => {
  await phone(page);
  await page.route('**/api/v1/points', (route) =>
    route.fulfill({
      json: {
        points: { available: '0', pending: '0' },
        walletKobo: '0',
        tier: {
          name: 'New',
          businesses: 0,
          next: { name: 'Bronze', businesses: 3 },
        },
        phoneVerified: false,
        referral: { code: null, referredBy: null, referred: 0, rewarded: 0 },
      },
    }),
  );
  await page.route('**/api/v1/wallet/bills/options', (route) =>
    route.fulfill({ json: { available: false, billers: [] } }),
  );
  await page.route('**/api/v1/wallet/bills?*', (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.goto('/wallet/bills');
  await expect(
    page.getByRole('heading', { name: 'Coming soon' }),
  ).toBeVisible();
  await healthy(page);
});

test('bring a friend: invite links carry the username and customers can share', async ({
  page,
}) => {
  await phone(page);
  const friendOffer = {
    ...offer,
    instructions: 'Buy any meal.',
    rewardBackingKobo: '100000',
    campaignTerms: {
      ...offer.campaignTerms,
      referral: { referrerKobo: '40000' },
    },
  };
  let invite: Record<string, unknown> | null = null;
  await page.route(`**/api/v1/work/tasks/${offerId}`, (route) =>
    route.fulfill({ json: { ...friendOffer, invite } }),
  );
  const bodies: unknown[] = [];
  await page.route(`**/api/v1/campaigns/${offerId}/codes`, (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        taskId: offerId,
        code: 'ABCDEFGHJK',
        display: 'ABCDE-FGHJK',
        expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
      },
    });
  });
  // A new customer arriving from a friend's link.
  invite = { canInvite: false, username: null, invited: 0, limit: 10 };
  await page.goto(`/offers/${offerId}?ref=Ada_Okafor`);
  await expect(
    page.getByText(/Invited by @ada_okafor\. If you are new/),
  ).toBeVisible();
  await expect(page.getByText(/you get ₦600 back/)).toBeVisible();
  await page.getByRole('button', { name: 'Get my code' }).click();
  await expect(page.getByText('ABCDE-FGHJK')).toBeVisible();
  expect(bodies).toEqual([{ ref: 'ada_okafor' }]);
  await healthy(page);

  // An existing customer sees their invite link.
  await page.evaluate(() => localStorage.clear());
  invite = { canInvite: true, username: 'bola', invited: 3, limit: 10 };
  await page.goto(`/offers/${offerId}`);
  const section = page.getByRole('region', { name: 'Invite friends' });
  await expect(section).toContainText('You get ₦400');
  await expect(section).toContainText('3 of 10 friends');
  await expect(
    section.getByRole('button', { name: 'Share your invite link' }),
  ).toBeVisible();
  await healthy(page);
});
