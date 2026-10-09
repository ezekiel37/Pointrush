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

const offerId = '4f3e2d1c-0b9a-4876-8543-210fedcba987';

test('a business page shows earlier names, live offers, and old handles lead to it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/businesses/mama_put', (route) =>
    route.fulfill({ json: { redirect: 'mama_put_ikeja' } }),
  );
  await page.route('**/api/v1/businesses/mama_put_ikeja', (route) =>
    route.fulfill({
      json: {
        handle: 'mama_put_ikeja',
        name: 'Mama Put Ikeja',
        description: 'Rice, swallow and grills on Allen Avenue.',
        since: '2026-08-01T10:00:00Z',
        formerly: [{ name: 'Mama Put Kitchen', until: '2026-10-01T10:00:00Z' }],
        offers: [
          {
            id: offerId,
            title: 'Lunch cash back',
            model: 'purchase_cashback',
            rewardKobo: '50000',
            endsAt: '2099-12-10T18:00:00Z',
          },
        ],
      },
    }),
  );
  await page.goto('/b/mama_put');
  await page.waitForURL('**/b/mama_put_ikeja');
  await expect(
    page.getByRole('heading', { name: 'Mama Put Ikeja' }),
  ).toBeVisible();
  await expect(page.getByText('Mama Put Kitchen')).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Lunch cash back/ }),
  ).toHaveAttribute('href', `/offers/${offerId}`);
  await healthy(page);
});

test('an owner changes the handle once and sees a rename wait for review', async ({
  page,
}) => {
  let handle = 'mama_put';
  let changes: Record<string, unknown>[] = [];
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/v1/handles/check?*', (route) =>
    route.fulfill({
      json: { available: true, reason: null, suggestion: null },
    }),
  );
  await page.route('**/api/v1/sponsor/profile/details', (route) =>
    route.fulfill({
      json: {
        id: '5b0f8d4e-1c2a-4e7a-9f3b-2d6c8a1e4f70',
        name: 'Mama Put Kitchen',
        contactEmail: 'owner@example.com',
        description: null,
        handle,
        since: '2026-08-01T10:00:00Z',
        canChangeHandle: handle === 'mama_put',
        nameNeedsReview: true,
        handles:
          handle === 'mama_put'
            ? [{ handle: 'mama_put', at: '2026-08-01T10:00:00Z' }]
            : [
                { handle, at: '2026-10-08T10:00:00Z' },
                { handle: 'mama_put', at: '2026-08-01T10:00:00Z' },
              ],
        changes,
      },
    }),
  );
  await page.route('**/api/v1/sponsor/profile/handle', (route) => {
    handle = route.request().postDataJSON().handle;
    return route.fulfill({ json: { handle } });
  });
  await page.route('**/api/v1/sponsor/profile/changes', (route) => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    changes = [
      {
        id: body.id,
        field: 'name',
        oldValue: 'Mama Put Kitchen',
        newValue: body.value,
        state: 'pending',
        note: null,
        at: '2026-10-09T10:00:00Z',
      },
    ];
    return route.fulfill({ json: { state: 'pending' } });
  });
  await page.goto('/business/profile');
  await page.getByLabel('Business handle').fill('mama_put_ikeja');
  await expect(page.getByText('@mama_put_ikeja is available.')).toBeVisible();
  await page.getByRole('button', { name: 'Change handle' }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Change your handle to @mama_put_ikeja?',
  });
  await expect(dialog.getByText(/This is your only change/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Change handle' }).click();
  await expect(page.getByText('@mama_put_ikeja').first()).toBeVisible();
  await expect(page.getByText(/Locked/)).toBeVisible();
  await expect(page.getByText(/Earlier handles still lead here/)).toBeVisible();

  await page.getByLabel('Business name').fill('Mama Put Ikeja');
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByText(/Sent for review/)).toBeVisible();
  await expect(
    page.getByText('Waiting for review', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Business name')).toBeDisabled();
  expect(bodies[0]).toMatchObject({ field: 'name', value: 'Mama Put Ikeja' });
  await healthy(page);
});

test('people change their name and username from account settings', async ({
  page,
}) => {
  let displayName = 'Ada';
  const sent: Record<string, unknown>[] = [];
  await page.route('**/api/v1/accounts/me', (route) =>
    route.fulfill({
      json: {
        onboarding: 'complete',
        accountType: 'personal',
        account: {
          id: '3d9a1c2b-7e6f-4a5b-8c9d-0e1f2a3b4c5d',
          username: 'ada_k',
          displayName,
          accessState: 'active',
        },
      },
    }),
  );
  await page.route('**/api/v1/accounts/me/display-name', (route) => {
    const body = route.request().postDataJSON();
    sent.push(body);
    if (sent.length > 1)
      return route.fulfill({
        status: 409,
        json: { statusCode: 409, reason: 'display_name_too_soon' },
      });
    displayName = body.displayName;
    return route.fulfill({ json: body });
  });
  await page.goto('/account');
  await page.getByRole('button', { name: 'Change name' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change your name' });
  await expect(dialog.getByLabel('Display name')).toBeFocused();
  await dialog.getByLabel('Display name').fill('Ada Kay');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Name changed')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Hello, Ada Kay.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Change name' }).click();
  await dialog.getByLabel('Display name').fill('Ada K');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(
    dialog.getByText(
      'You changed your name in the last 7 days. Try again later.',
    ),
  ).toBeVisible();
});

test('reviewers approve or refuse a business rename with a reason', async ({
  page,
}) => {
  const decisions: Record<string, unknown>[] = [];
  const changeId = '6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d';
  await page.route('**/api/v1/admin/profile-changes', (route) =>
    route.fulfill({
      json: {
        items: decisions.length
          ? []
          : [
              {
                id: changeId,
                sponsorId: '5b0f8d4e-1c2a-4e7a-9f3b-2d6c8a1e4f70',
                handle: 'mama_put',
                field: 'name',
                oldValue: 'Mama Put Kitchen',
                newValue: 'Shoprite Express',
                at: '2026-10-09T10:00:00Z',
              },
            ],
      },
    }),
  );
  await page.route(
    `**/api/v1/admin/profile-changes/${changeId}/decisions`,
    (route) => {
      decisions.push(route.request().postDataJSON());
      return route.fulfill({ json: { decision: 'rejected' } });
    },
  );
  await page.goto('/admin/renames');
  await expect(page.getByText('Shoprite Express')).toBeVisible();
  await page.getByRole('button', { name: 'Refuse' }).click();
  const dialog = page.getByRole('dialog', { name: /Refuse/ });
  await dialog.getByLabel('Reason').fill('Uses another brand’s name');
  await healthy(page);
  await dialog.getByRole('button', { name: 'Refuse' }).click();
  await expect(page.getByText('Refused', { exact: true })).toBeVisible();
  await expect(page.getByText('Nothing waiting.')).toBeVisible();
  expect(decisions).toEqual([
    { decision: 'rejected', reason: 'Uses another brand’s name' },
  ]);
});

test('a profile picture is uploaded and shown; a new logo waits for review', async ({
  page,
}) => {
  const avatarId = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
  const logoId = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
  let avatar: string | null = null;
  let logoPending = false;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );
  await page.route('**/api/v1/accounts/me', (route) =>
    route.fulfill({
      json: {
        onboarding: 'complete',
        accountType: 'personal',
        account: {
          id: '3d9a1c2b-7e6f-4a5b-8c9d-0e1f2a3b4c5d',
          username: 'ada_k',
          displayName: 'Ada',
          accessState: 'active',
        },
      },
    }),
  );
  await page.route('**/api/v1/accounts/me/avatar', (route) => {
    if (route.request().method() === 'POST')
      avatar = route.request().postDataJSON().fileId;
    return route.fulfill({ json: { fileId: avatar } });
  });
  await page.route('**/api/v1/files?purpose=*', (route) => {
    const purpose = new URL(route.request().url()).searchParams.get('purpose');
    return route.fulfill({
      status: 201,
      json: {
        id: purpose === 'logo' ? logoId : avatarId,
        purpose,
        contentType: 'image/png',
        sizeBytes: png.length,
      },
    });
  });
  await page.route('**/api/v1/files/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: png }),
  );
  await page.goto('/account');
  await page.locator('input[type=file]').setInputFiles({
    name: 'me.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await expect(page.getByText('Picture updated')).toBeVisible();
  await expect(page.getByAltText('Your profile picture')).toHaveAttribute(
    'src',
    new RegExp(`/files/public/${avatarId}$`),
  );
  // Too big a file is refused before it is sent.
  await page.locator('input[type=file]').setInputFiles({
    name: 'huge.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(3 * 1024 * 1024, 1),
  });
  await expect(page.getByText(/That file is too big/)).toBeVisible();

  await page.route('**/api/v1/sponsor/profile/details', (route) =>
    route.fulfill({
      json: {
        id: '5b0f8d4e-1c2a-4e7a-9f3b-2d6c8a1e4f70',
        name: 'Mama Put Kitchen',
        contactEmail: 'owner@example.com',
        description: null,
        logoFileId: null,
        handle: 'mama_put',
        since: '2026-08-01T10:00:00Z',
        canChangeHandle: false,
        nameNeedsReview: true,
        handles: [{ handle: 'mama_put', at: '2026-08-01T10:00:00Z' }],
        changes: logoPending
          ? [
              {
                id: '7d6c5b4a-3e2f-4a1b-9c8d-7e6f5a4b3c2d',
                field: 'logo',
                oldValue: null,
                newValue: logoId,
                state: 'pending',
                note: null,
                at: '2026-10-09T10:00:00Z',
              },
            ]
          : [],
      },
    }),
  );
  await page.route('**/api/v1/sponsor/profile/changes', (route) => {
    logoPending = true;
    expect(route.request().postDataJSON()).toMatchObject({
      field: 'logo',
      value: logoId,
    });
    return route.fulfill({ json: { state: 'pending' } });
  });
  await page.goto('/business/profile');
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await expect(page.getByText(/Logo sent for review/)).toBeVisible();
  await expect(page.getByAltText('New logo waiting for review')).toBeVisible();
  await expect(page.getByText('In review')).toBeVisible();
  await healthy(page);
});
