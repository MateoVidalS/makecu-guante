import { test, expect } from '@playwright/test';
import { calibration } from '../../contracts/fixtures.check';
const usable = {
  ...calibration,
  camera: {
    ...calibration.camera,
    closed_flex: { thumb: 100, index: 270, middle: 270, ring: 270, pinky: 270 },
  },
};

test('ready Setup statuses and Continue fit at 1280×720', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/setup');
  const summary = page.getByLabel('Setup readiness');
  await expect(summary.getByText('Ready', { exact: true })).toBeVisible();
  await expect(
    summary.getByText('Sees the hand', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Continue to calibration' }),
  ).toBeInViewport({ ratio: 1 });
  await expect(summary).toBeInViewport({ ratio: 1 });
  expect(
    await page
      .locator('.setup-page .camera-overlay')
      .evaluate((node) => node.getBoundingClientRect().width),
  ).toBeGreaterThanOrEqual(480);
  await expect(
    page.locator('details').filter({
      has: page.locator('summary', { hasText: 'How to place the camera' }),
    }),
  ).not.toHaveAttribute('open');
  await expect(page.locator('main .ds-button--primary')).toHaveCount(1);
});

test('invalid calibration agrees across helper pages and repairs the right finger', async ({
  page,
}) => {
  await page.route('**/api/calibrations/latest', (route) =>
    route.fulfill({
      json: {
        ...usable,
        camera: {
          ...usable.camera,
          closed_flex: { ...usable.camera.closed_flex, index: 200 },
        },
      },
    }),
  );
  await page.goto('/');
  await expect(
    page.getByText('Needs a quick redo', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: "Start today's practice" }).click();
  await expect(page).toHaveURL(/calibrate\?step=camera&finger=index/);
  await expect(
    page.getByRole('heading', { name: 'Step 2 · Camera range: Index' }),
  ).toBeVisible();
  await expect(
    page.getByText('Needs a quick redo', { exact: true }),
  ).toBeVisible();
  await page.goto('/evaluate');
  await expect(
    page.getByText('Needs a quick redo', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Fix', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Step 2 · Camera range: Index' }),
  ).toBeVisible();
});

test('valid saved calibration opens Review and offers one simulator shortcut', async ({
  page,
}) => {
  await page.route('**/api/calibrations/latest', (route) =>
    route.fulfill({ json: usable }),
  );
  await page.goto('/calibrate');
  await expect(
    page.getByRole('heading', { name: 'Review your range' }),
  ).toBeVisible();
  await expect(page.getByText(/Not set/i)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Save calibration' }),
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Calibrate simulator', exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Use simulated glove ranges' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo glove ranges' }).click();
  await expect(page.locator('main .ds-button--primary')).toHaveCount(1);
  await expect(
    page
      .getByRole('button', { name: 'Release glove now' })
      .locator(
        'xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," ")," ds-banner ")][1]',
      ),
  ).toHaveClass(/ds-banner--warning/);
});
