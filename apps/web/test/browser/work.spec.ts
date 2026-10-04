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
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Your session has ended',
  );
  await expect(page.getByRole('link', { name: task.title })).toHaveCount(0);
});

test('proof retries retain their identity and text after a dropped response', async ({
  page,
}) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route(`**/api/v1/work/claims/${id}`, (route) =>
    route.fulfill({
      json: {
        participant: true,
        observedAt: '2026-10-02T12:00:00Z',
        claim: { id, taskId: id, accountId: id, createdAt: task.startsAt },
        task: {
          ...task,
          instructions: 'Write an account of your work.',
          proofRequirements: 'Include the reference.',
          rejectionCriteria: 'Copied work.',
          workTerms: { reviewHours: 48, correctionHours: 24, appealHours: 48 },
        },
        proofs:
          bodies.length > 1
            ? [
                {
                  proof: {
                    ...bodies[1],
                    claimId: id,
                    createdAt: task.startsAt,
                  },
                  decision: null,
                  receipt: null,
                  appeal: null,
                  resolution: null,
                },
              ]
            : [],
      },
    }),
  );
  await page.route(`**/api/v1/work/claims/${id}/proofs`, async (route) => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) return route.abort();
    return route.fulfill({
      json: { ...bodies[1], claimId: id, createdAt: task.startsAt },
    });
  });
  await page.goto(`/my-tasks/${id}`);
  await page.getByRole('button', { name: 'Submit proof', exact: true }).click();
  await expect(page.getByLabel('Submit proof', { exact: true })).toBeFocused();
  await page
    .getByLabel('Submit proof', { exact: true })
    .fill('My evidence reference 123');
  await page.getByRole('button', { name: 'Submit proof', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'could not confirm',
  );
  await expect(
    page.getByLabel('Submit proof', { exact: true }),
  ).toHaveAttribute('readonly', '');
  await page.getByRole('button', { name: 'Retry same submission' }).click();
  await expect(page.getByText('Awaiting sponsor review')).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('viewing a rejection never acknowledges it automatically', async ({
  page,
}) => {
  let acknowledgements = 0;
  await page.route(`**/api/v1/work/claims/${id}`, (route) =>
    route.fulfill({
      json: {
        participant: true,
        observedAt: '2026-10-02T12:00:00Z',
        claim: { id, taskId: id, accountId: id, createdAt: task.startsAt },
        task: {
          ...task,
          instructions: 'Brief',
          proofRequirements: 'Reference',
          rejectionCriteria: 'Missing reference',
          workTerms: { reviewHours: 48, correctionHours: 24, appealHours: 48 },
        },
        proofs: [
          {
            proof: {
              id,
              claimId: id,
              revision: 1,
              evidence: 'Work',
              createdAt: task.startsAt,
            },
            decision: {
              decision: 'rejected',
              reason: 'Missing reference',
              createdAt: task.startsAt,
            },
            receipt: acknowledgements
              ? { proofId: id, createdAt: '2026-10-02T12:00:00Z' }
              : null,
            appeal: null,
            resolution: null,
          },
        ],
      },
    }),
  );
  await page.route(`**/api/v1/work/proofs/${id}/acknowledgements`, (route) => {
    acknowledgements++;
    return route.fulfill({
      json: { proofId: id, createdAt: '2026-10-02T12:00:00Z' },
    });
  });
  await page.goto(`/my-tasks/${id}`);
  await expect(
    page.getByRole('button', {
      name: 'Acknowledge decision and start response window',
    }),
  ).toBeVisible();
  expect(acknowledgements).toBe(0);
  await expect(
    page.getByRole('button', { name: 'Submit appeal', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', {
      name: 'Acknowledge decision and start response window',
    })
    .click();
  await expect(
    page.getByRole('button', { name: 'Submit appeal', exact: true }),
  ).toBeVisible();
  expect(acknowledgements).toBe(1);
});

test('sponsor review requires confirmation and replays an uncertain decision unchanged', async ({
  page,
}) => {
  let saved: Record<string, unknown> | null = null;
  const bodies: Record<string, unknown>[] = [];
  await page.route(`**/api/v1/work/claims/${id}`, (route) =>
    route.fulfill({
      json: {
        participant: false,
        observedAt: '2026-10-03T12:00:00Z',
        claim: { id, taskId: id, accountId: id, createdAt: task.startsAt },
        task: {
          ...task,
          instructions: 'Brief',
          proofRequirements: 'Reference',
          rejectionCriteria: 'Missing reference',
          workTerms: { reviewHours: 48, correctionHours: 24, appealHours: 48 },
        },
        proofs: [
          {
            proof: {
              id,
              claimId: id,
              revision: 2,
              evidence: 'Corrected evidence',
              createdAt: task.startsAt,
            },
            decision: saved,
            receipt: null,
            appeal: null,
            resolution: null,
          },
        ],
      },
    }),
  );
  await page.route(`**/api/v1/work/proofs/${id}/decisions`, (route) => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) return route.abort();
    saved = { ...bodies[1], createdAt: task.startsAt };
    return route.fulfill({ json: saved });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/sponsor/claims/${id}`);
  await expect(page.getByText('Corrected evidence')).toBeVisible();
  await expect(
    page.getByRole('radio', { name: 'Request one correction' }),
  ).toHaveCount(0);
  await page.getByRole('radio', { name: 'Approve work' }).check();
  await page
    .getByLabel('Reason for your decision')
    .fill('The corrected reference meets the requirements.');
  await page
    .getByRole('button', { name: 'Review decision before confirming' })
    .click();
  expect(bodies).toHaveLength(0);
  await expect(
    page.getByRole('heading', { name: 'Confirm: Approve work' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Confirm decision', exact: true })
    .click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'could not confirm',
  );
  await expect(
    page.getByRole('button', { name: 'Back to editing' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry same decision' }).click();
  await expect(
    page.getByText('No submission is awaiting your decision.'),
  ).toBeVisible();
  expect(bodies[0]).toEqual(bodies[1]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('appeal access failures expose a recovery path without displaying private evidence', async ({
  page,
}) => {
  await page.route('**/api/v1/work/appeals?*', (route) =>
    route.fulfill({ status: 403, json: {} }),
  );
  await page.goto('/review/appeals');
  await expect(page.locator('main').getByRole('alert')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Verify authenticator in another tab' }),
  ).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});
