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

async function phone(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
}
async function healthy(page: Page) {
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
  await expect(page.getByRole('link', { name: 'Find offers' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Claim a prize' })).toBeVisible();
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
  await expect(page.getByText('Added to your wallet')).toBeVisible();
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
  await page.goto('/wallet');
  await expect(page.getByText('₦1,000', { exact: true })).toBeVisible();
  // Held money shows its own total and a label, never as wallet money.
  await expect(page.getByText('₦700', { exact: true })).toBeVisible();
  await expect(page.getByText('Held', { exact: true })).toBeVisible();
  await healthy(page);
  await page.getByRole('button', { name: 'Move to wallet' }).click();
  await expect(page.getByText('₦1,500', { exact: true })).toBeVisible();
  await expect(page.getByText('In wallet', { exact: true })).toBeVisible();
  expect(released).toBe(1);
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
