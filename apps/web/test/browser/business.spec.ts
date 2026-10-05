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
