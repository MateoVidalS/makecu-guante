import { test, expect } from '@playwright/test';
import { calibration as fixture } from '../src/contracts/fixtures.check';

test('an undersized example camera range is flagged before practice sends motion', async ({
  page,
}) => {
  // Model finger flex reaches 270 degrees; a stale 200-degree example span
  // would normalize above 100% after mixing it with new servo ranges.
  await page.route('**/api/calibrations/latest', (route) =>
    route.fulfill({
      json: { ...fixture, created_at: new Date().toISOString() },
    }),
  );
  let sessionsCreated = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/sessions'))
      sessionsCreated++;
  });
  await page.goto('/exercise');
  await page
    .getByRole('button', { name: 'Start practice', exact: true })
    .click();
  await expect(
    page
      .getByRole('alert')
      .filter({
        hasText: /Camera range would report over 100% for your index/,
      }),
  ).toBeVisible();
  await expect(page.locator('.focus')).toHaveCount(0);
  expect(sessionsCreated).toBe(0);
});
