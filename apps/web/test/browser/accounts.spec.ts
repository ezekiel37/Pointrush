import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext } from '@playwright/test';

async function mail(request: APIRequestContext, email: string, kind: string) {
  const response = await request.get(
    `http://localhost:8081/__test/mail?email=${encodeURIComponent(email)}`,
  );
  const messages: { kind: string; url: string }[] = await response.json();
  const message = messages.filter((item) => item.kind === kind).at(-1);
  expect(message).toBeTruthy();
  return message!.url;
}

test('signup, verification, onboarding, signout and recovery use the real API', async ({
  page,
  request,
}) => {
  const email = 'browser@example.test';
  const password = 'My browser passphrase 123!';
  await page.goto('/signup');
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(page.getByLabel('Display name', { exact: true })).toBeFocused();
  await page.getByLabel('Display name', { exact: true }).fill('Ezekiel');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Show password', exact: true })
    .first()
    .click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'type',
    'text',
  );
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(
    page.getByText('Check your inbox for a verification link.', {
      exact: false,
    }),
  ).toBeVisible();
  await page.goto(await mail(request, email, 'verify-email'));
  await expect(page).toHaveURL(/\/login\?verified=1/);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Make it yours' }),
  ).toBeVisible();
  await page.getByLabel('Display name', { exact: true }).fill('Ezekiel');
  await page.getByLabel('Username', { exact: true }).fill('browser_user');
  await page.getByRole('button', { name: 'Complete setup' }).click();
  await expect(
    page.getByRole('heading', { name: 'Hello, Ezekiel.' }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(
    page.getByRole('heading', { name: 'Let’s get you back in' }),
  ).toBeVisible();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: /If this address|Your password/ }),
  ).toContainText('If this address is eligible');
  await page.goto(await mail(request, email, 'reset-password'));
  await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password$/);
  const newPassword = 'My replacement passphrase 456!';
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page
    .getByLabel('Confirm new password', { exact: true })
    .fill(newPassword);
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: /If this address|Your password/ }),
  ).toContainText('Your password has been changed');
  await page.getByRole('link', { name: 'Back to sign in' }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Hello, Ezekiel.' }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
});

test('mobile forms support keyboard, validation, offline failure and accessible recovery', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Email address')).toBeFocused();
  await expect(page.getByLabel('Email address')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByLabel('Email address').fill('offline@example.test');
  await page
    .getByLabel('Password', { exact: true })
    .fill('a sufficiently long password');
  await page.route('**/api/v1/auth/sign-in/email', (route) => route.abort());
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Email address')).toHaveValue(
    'offline@example.test',
  );
  await expect(
    page.getByRole('button', { name: 'Sign in', exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/login-mobile.png',
    fullPage: true,
  });
  await page.goto('/signup');
  await expect(page.getByLabel('Display name', { exact: true })).toBeEnabled();
  await page.screenshot({
    path: 'test-results/signup-mobile.png',
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: 'test-results/signup-desktop.png',
    fullPage: true,
  });
});

test('account failure, expired session and restriction states never show fake balances', async ({
  page,
}) => {
  await page.route('**/api/v1/accounts/me', (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.goto('/account');
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'temporarily unavailable',
  );
  await page.unroute('**/api/v1/accounts/me');
  await page.route('**/api/v1/accounts/me', (route) =>
    route.fulfill({
      json: {
        onboarding: 'complete',
        account: {
          id: 'f04ce6fe-15e4-4a6e-9cdf-8e89562407cf',
          username: 'restricted_user',
          displayName:
            'A long display name that should wrap gracefully on a small mobile screen',
          accessState: 'suspended',
        },
      },
    }),
  );
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(
    page.getByRole('heading', { name: 'Account suspended' }),
  ).toBeVisible();
  await expect(page.getByText('₦')).toHaveCount(0);
  await page.unroute('**/api/v1/accounts/me');
  await page.route('**/api/v1/accounts/me', (route) =>
    route.fulfill({ status: 401, json: {} }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Your session has ended',
  );
  await expect(
    page.getByRole('heading', { name: 'Account suspended' }),
  ).toHaveCount(0);
});

test('a missing reset link has a clear recovery route', async ({ page }) => {
  await page.goto('/reset-password');
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'missing or invalid',
  );
  await page.getByRole('link', { name: 'Request a new reset link' }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
});

test('onboarding preserves entries after conflict and expiry; duplicate submits stay locked', async ({
  page,
}) => {
  let posts = 0;
  let finish: (() => void) | undefined;
  let complete = false;
  await page.route('**/api/v1/accounts/me', async (route) => {
    if (route.request().method() === 'POST') {
      posts++;
      if (posts <= 2)
        return route.fulfill({ status: posts === 1 ? 409 : 401, json: {} });
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      complete = true;
      return route.fulfill({ status: 201, json: {} });
    }
    return route.fulfill({
      json: complete
        ? {
            onboarding: 'complete',
            account: {
              id: 'f04ce6fe-15e4-4a6e-9cdf-8e89562407cf',
              username: 'saved_user',
              displayName: 'Saved Name',
              accessState: 'active',
            },
          }
        : { onboarding: 'required', account: null },
    });
  });
  await page.goto('/account');
  await page.getByLabel('Display name', { exact: true }).fill('Saved Name');
  await page.getByLabel('Username', { exact: true }).fill('saved_user');
  await page.getByRole('button', { name: 'Complete setup' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'username is unavailable',
  );
  await expect(page.getByLabel('Username', { exact: true })).toHaveValue(
    'saved_user',
  );
  await page.getByRole('button', { name: 'Complete setup' }).click();
  await expect(
    page.getByRole('link', { name: 'Open sign in' }),
  ).toHaveAttribute('target', '_blank');
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue(
    'Saved Name',
  );
  await page.getByRole('button', { name: 'Complete setup' }).click();
  await expect(
    page.getByRole('button', { name: 'Saving profile…' }),
  ).toBeDisabled();
  await expect.poll(() => posts).toBe(3);
  await page
    .getByRole('button', { name: 'Saving profile…' })
    .dispatchEvent('click');
  expect(posts).toBe(3);
  finish!();
  await expect(
    page.getByRole('heading', { name: 'Hello, Saved Name.' }),
  ).toBeVisible();
});

test('forms cannot submit credentials before JavaScript loads', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('http://localhost:3100/signup');
  await expect(page.getByLabel('Password', { exact: true })).toBeDisabled();
  await expect(page.locator('form')).toHaveAttribute('method', 'post');
  await expect(
    page.getByText('Loading the form. Enable JavaScript if it does not open.'),
  ).toBeVisible();
  await context.close();
});
