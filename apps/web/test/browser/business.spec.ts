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
