import { test, expect } from '@playwright/test';
import { calibration as fixture } from '../src/contracts/fixtures.check';
import {
  CURRENT_CAMERA_VIEW,
  CURRENT_FLEX_MODEL,
} from '../src/contracts/calibration';

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
        assist_direction: 'open',
        camera: {
          ...fixture.camera,
          camera_view: CURRENT_CAMERA_VIEW,
          flex_model: CURRENT_FLEX_MODEL,
        },
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

for (const direction of ['close', undefined] as const) {
  test(`legacy ${direction ?? 'unmarked'} calibration blocks practice and evaluation before motion`, async ({
    page,
  }) => {
    const calibration = {
      ...fixture,
      assist_direction: direction,
      camera: {
        ...fixture.camera,
        camera_view: CURRENT_CAMERA_VIEW,
        flex_model: CURRENT_FLEX_MODEL,
        closed_flex: {
          thumb: 100,
          index: 270,
          middle: 270,
          ring: 270,
          pinky: 270,
        },
      },
    };
    await page.route('**/api/calibrations/latest', (route) =>
      route.fulfill({ json: calibration }),
    );
    let runs = 0;
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        /\/api\/(sessions|evaluations)$/.test(request.url())
      )
        runs++;
    });
    for (const [url, action] of [
      ['/exercise', 'Start practice'],
      ['/evaluate', 'Start evaluation'],
    ]) {
      await page.goto(url);
      await expect(
        page
          .getByText('The glove now helps the hand open. Calibrate it again.')
          .first(),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: action, exact: true }),
      ).toBeDisabled();
    }
    expect(runs).toBe(0);
  });
}
