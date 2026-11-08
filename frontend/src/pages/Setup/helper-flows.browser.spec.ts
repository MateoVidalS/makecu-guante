import { test, expect } from '@playwright/test';
import { calibration } from '../../contracts/fixtures.check';
const usable = {
  ...calibration,
  assist_direction: 'open' as const,
  camera: {
    ...calibration.camera,
    camera_view: 'front_upright' as const,
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

test('legacy camera capture routes to upright recapture while keeping glove ranges', async ({
  page,
}) => {
  await page.route('**/api/calibrations/latest', (route) =>
    route.fulfill({
      json: {
        ...usable,
        camera: { ...usable.camera, camera_view: 'front_diagonal' },
      },
    }),
  );
  await page.goto('/');
  await expect(
    page.getByText(
      'Your camera range was captured in the old position. Recapture it with your hand raised.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: "Start today's practice" }).click();
  await expect(page).toHaveURL(/calibrate\?step=camera/);
  await expect(
    page.getByText(/Raise your hand, palm to the screen/),
  ).toBeVisible();
  await expect(page.getByText('Not captured', { exact: true })).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: 'Continue to review' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: /Glove range/ }).click();
  for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'])
    await expect(
      page.getByRole('button', { name: `${finger} · Set` }),
    ).toBeVisible();
});

test('upright placement diagram and lighting guide are visible', async ({
  page,
}) => {
  await page.goto('/setup');
  await page.getByText('How to place the camera', { exact: true }).click();
  await expect(
    page.getByRole('img', { name: /Raised hand beside the face/ }),
  ).toBeVisible();
  await expect(
    page.getByText(/Raise your hand beside your face/),
  ).toBeVisible();
  await expect(
    page.getByText(/Avoid a bright window behind you/),
  ).toBeVisible();
  await page
    .locator('.setup-placement')
    .screenshot({ path: '/tmp/v2-upright-placement.png' });
});

test('opening calibration shows Slack, straight-finger warning and active fist capture', async ({
  page,
}) => {
  await page.route('**/api/calibrations/latest', (route) =>
    route.fulfill({ json: usable }),
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/calibrate?step=glove');
  await expect(
    page.getByRole('button', { name: 'Set slack', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Set open', exact: true }),
  ).toHaveAttribute('aria-describedby', 'hyperextension-warning');
  await expect(page.getByText(/Hyperextension warning/)).toBeVisible();
  await page.screenshot({
    path: 'src/pages/Calibrate/screenshots/open-servo-1280.png',
    fullPage: true,
  });
  await page.goto('/calibrate?step=camera');
  await expect(
    page.getByRole('button', { name: 'Capture my fist' }),
  ).toBeVisible();
  await expect(
    page.getByText('Relax. The glove opens all five fingers in stages.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Glove opens the hand' }),
  ).toBeVisible();
  await page.screenshot({
    path: 'src/pages/Calibrate/screenshots/open-camera-1280.png',
    fullPage: true,
  });
});

test('legacy closing assistance requires completely new glove ranges', async ({
  page,
}) => {
  await page.route('**/api/calibrations/latest', (route) =>
    route.fulfill({ json: { ...usable, assist_direction: 'close' } }),
  );
  await page.goto('/calibrate');
  await expect(
    page.getByText('The glove now helps the hand open. Calibrate it again.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Step 1 · Glove range: Thumb' }),
  ).toBeVisible();
  await expect(page.getByText('Slack not set', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Next finger' }),
  ).toBeDisabled();
});
