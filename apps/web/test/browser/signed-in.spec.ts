import { test, expect } from '@playwright/test';

const signedIn = {
  onboarding: 'complete',
  accountType: 'personal',
  account: {
    id: '7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
    username: 'ada',
    displayName: 'Ada',
    accessState: 'active',
  },
};

test('signed-in people skip the sign-in form and see a way back into the app', async ({
  page,
}) => {
  await page.route('**/api/v1/accounts/me', (route) =>
    route.fulfill({ json: signedIn }),
  );
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Open app' })).toHaveAttribute(
    'href',
    '/account?home=1',
  );
  await expect(page.getByRole('link', { name: 'Get started' })).toHaveCount(0);
  await page.goto('/login?next=%2Fwallet');
  await page.waitForURL('**/wallet');
});

test('shared links carry a preview, the favicon exists and the sitemap lists public pages', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    'content',
    'summary_large_image',
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  expect((await request.get('/favicon.ico')).status()).toBe(200);
  const image = await request.get(
    (await page
      .locator('meta[property="og:image"]')
      .getAttribute('content'))!.replace(/^https?:\/\/[^/]+/, ''),
  );
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toContain('image/png');
  expect(await (await request.get('/sitemap.xml')).text()).toContain(
    '/terms/business',
  );
});

test('authenticator setup shows a QR code to scan', async ({ page }) => {
  await page.route('**/api/v1/auth/two-factor/enable', (route) =>
    route.fulfill({
      json: {
        method: 'totp',
        totpURI:
          'otpauth://totp/Acticlaim:ada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Acticlaim',
        backupCodes: ['aaaa-bbbb', 'cccc-dddd'],
      },
    }),
  );
  await page.goto('/two-factor?mode=enroll');
  await expect(
    page.getByRole('heading', { name: 'Protect reviewer access' }),
  ).toBeVisible();
  await page.locator('#password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page.getByAltText('QR code to add Acticlaim to your authenticator app'),
  ).toBeVisible();
});
