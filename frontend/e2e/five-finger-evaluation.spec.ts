import { test, expect } from '@playwright/test';
import { calibrateSimulator } from './helpers';
import { calibration as fixture } from '../src/contracts/fixtures.check';
import type { Evaluation } from '../src/contracts/api';

test('a ring/little-finger subset persists four sweeps and opens evaluation detail', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const calibration = await calibrateSimulator(page);
  // A fresh, complete synthetic baseline isolates subset selection from the
  // separately tested unhooked-thread friction flow. Never used on hardware.
  const saved = await page.request.post('/api/calibrations', {
    data: {
      assist_direction: 'open',
      servo: calibration.servo,
      camera: calibration.camera,
      friction: fixture.friction,
      current_limit_ma: 1500,
    },
  });
  expect(saved.ok()).toBe(true);
  const baseline = await saved.json();
  await page.route('**/api/calibrations/latest', (route) =>
    route.fulfill({ json: baseline }),
  );
  await page.goto('/evaluate');
  const fingers = page.getByRole('group', { name: 'Fingers to measure' });
  await expect(fingers.getByRole('checkbox', { checked: true })).toHaveCount(5);
  for (const name of ['Thumb', 'Index', 'Middle'])
    await fingers.getByRole('checkbox', { name, exact: true }).uncheck();
  await expect(fingers.getByRole('checkbox', { checked: true })).toHaveCount(2);
  await page
    .getByRole('checkbox', {
      name: 'Threads re-hooked to yellow fingertip anchors; hand relaxed',
      exact: true,
    })
    .check();
  const stored = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/api/evaluations'),
    { timeout: 60_000 },
  );
  await page
    .getByRole('button', { name: 'Start evaluation', exact: true })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Resistance to opening (flexor tone)',
      exact: true,
    }),
  ).toBeVisible({ timeout: 60_000 });
  const result = (await (await stored).json()) as Evaluation;
  expect(result.settings.fingers).toEqual(['ring', 'pinky']);
  expect(result.fingers.map((f) => f.finger)).toEqual(['ring', 'pinky']);
  expect(result.sweeps.map((s) => [s.finger, s.speed])).toEqual([
    ['ring', 'slow'],
    ['ring', 'fast'],
    ['pinky', 'slow'],
    ['pinky', 'fast'],
  ]);
  expect(result.is_demo).toBe(true);
  await expect(
    page.getByRole('status', { name: 'Session saving status' }),
  ).toHaveText('Saved');
  await page.goto(`/history/evaluations/${result.id}`);
  await expect(
    page.getByRole('heading', { name: 'Evaluation detail', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Ring', { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText(/^(Pinky|Little finger)$/, { exact: true }).first(),
  ).toBeVisible();
});
