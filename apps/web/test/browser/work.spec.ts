import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const id = '83a31de2-f3af-4f3f-917c-f2879966c727';
const task = {
  id,
  title: 'Photograph a book display',
  businessName: 'Test Bookshop',
  startsAt: '2026-10-01T09:00:00Z',
  endsAt: '2026-10-10T09:00:00Z',
  rewardBackingKobo: '125050',
  claimed: 1,
  capacity: 2,
};

test('task search resets pagination and clear restores the list on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/work/tasks?*', (route) => {
    const query = new URL(route.request().url()).searchParams.get('q');
    return route.fulfill({
      json: { items: query ? [] : [task], nextCursor: null },
    });
  });
  await page.goto(`/tasks?after=${id}`);
  await expect(page.getByRole('link', { name: task.title })).toBeVisible();
  await page.getByLabel('Search task titles').fill('missing');
  await expect(page).toHaveURL(/\/tasks\?q=missing$/);
  await expect(
    page.getByRole('heading', { name: 'No matching tasks' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByLabel('Search task titles')).toBeFocused();
  await expect(page.getByRole('link', { name: task.title })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('joining requires reading terms, locks duplicate submits and explains reward availability', async ({
  page,
}) => {
  let posts = 0;
  let finish: (() => void) | undefined;
  await page.route(`**/api/v1/work/tasks/${id}`, (route) =>
    route.fulfill({
      json: {
        ...task,
        instructions: 'Take a clear photo.',
        proofRequirements: 'Describe the display.',
        rejectionCriteria: 'Copied evidence.',
        termsVersion: 1,
        workTerms: {
          reviewHours: 48,
          correctionHours: 24,
          appealHours: 48,
          settlement: 'approved_reward_backing',
        },
      },
    }),
  );
  await page.route(`**/api/v1/work/tasks/${id}/join`, async (route) => {
    posts++;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    await route.fulfill({
      json: { id, taskId: id, accountId: id, createdAt: task.startsAt },
    });
  });
  await page.goto(`/tasks/${id}`);
  await expect(page.getByRole('button', { name: 'Join task' })).toBeDisabled();
  await expect(page.getByText(/Cash withdrawal/)).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Join task' }).click();
  await expect.poll(() => posts).toBe(1);
  await expect(
    page.getByRole('button', { name: 'Confirming your place…' }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Confirming your place…' })
    .dispatchEvent('click');
  expect(posts).toBe(1);
  finish!();
  await expect(
    page.getByText('Your place is confirmed.', { exact: false }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('session expiry clears private claim data on reconnect', async ({
  page,
}) => {
  let expired = false;
  await page.route('**/api/v1/work/claims?*', (route) =>
    route.fulfill(
      expired
        ? { status: 401, json: {} }
        : {
            json: {
              items: [
                {
                  id,
                  taskId: id,
                  title: task.title,
                  joinedAt: task.startsAt,
                  endsAt: task.endsAt,
                  latestProofId: null,
                  approvedBackingKobo: '0',
                },
              ],
              nextCursor: null,
            },
          },
    ),
  );
  await page.goto('/my-tasks');
  await expect(page.getByRole('link', { name: task.title })).toBeVisible();
  expired = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('alert')).toContainText('Your session has ended');
  await expect(page.getByRole('link', { name: task.title })).toHaveCount(0);
});
