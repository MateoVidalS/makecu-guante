import { test, expect } from '@playwright/test';
import { calibration as fixture } from '../src/contracts/fixtures.check';
import { CURRENT_CAMERA_VIEW } from '../src/contracts/calibration';

test('an undersized example camera range is flagged before practice sends motion', async ({
  page,
}) => {
  // Model finger flex reaches 270 degrees; a stale 200-degree example span
  // would normalize above 100% after mixing it with new servo ranges.
  await page.route('**/api/calibrations/latest', (route) =>
    route.fulfill({
      // Captured in the current view, so the range check (not the old-view
      // recapture rule) is what blocks practice.
      json: {
        ...fixture,
        camera: { ...fixture.camera, camera_view: CURRENT_CAMERA_VIEW },
        created_at: new Date().toISOString(),
      },
    }),
  );
  let sessionsCreated = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/sessions'))
      sessionsCreated++;
  });
  await page.goto('/exercise');
  await expect(
    page.getByRole('button', { name: 'Start practice', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText('Your index range needs a quick redo.').first(),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Redo camera range', exact: true }),
  ).toHaveAttribute('href', '/calibrate?step=camera&finger=index');
  await expect(page.locator('.focus')).toHaveCount(0);
  expect(sessionsCreated).toBe(0);
});
