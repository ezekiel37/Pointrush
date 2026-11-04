import { test, expect } from '@playwright/test';

test('the home page never scrolls sideways, on desktop or phone', async ({
  page,
}) => {
  for (const width of [1126, 1440, 390]) {
    await page.setViewportSize({ width, height: 877 });
    await page.goto('/');
    await page.evaluate(() => window.scrollTo(500, 0));
    expect(await page.evaluate(() => window.scrollX), `${width}px`).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `${width}px`,
    ).toBe(true);
  }
  // The example prize code matches the real format.
  await expect(page.getByText('AC-7K4M-9X2Q-PRDH-3VBN').first()).toBeAttached();
});
