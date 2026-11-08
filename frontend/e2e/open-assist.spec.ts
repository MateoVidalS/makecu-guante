import { expect, test } from '@playwright/test';
import type { Calibration } from '../src/contracts/calibration';
import type { SessionDetail } from '../src/contracts/api';
import { DEFAULT_PLAN, MAX_ASSIST_PULL } from '../src/contracts/poses';
import type {} from './ai-therapist-harness';
import { silenceCoach } from './helpers';

test('manual slack/open and camera calibration leads to ten moderate fist/open attempts and direction-marked history', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await silenceCoach(page);
  await page.route('**/api/calibrations/latest', (route) =>
    route.fulfill({ json: null }),
  );
  await page.goto('/e2e/ai-therapist.html');
  await expect
    .poll(() => page.evaluate(() => window.aiTherapist.ready()))
    .toBe(true);
  await page.evaluate(() => window.aiTherapist.calibrationClock(true));
  const fingers = page.getByRole('group', { name: 'Finger to calibrate' });
  for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
    await fingers
      .getByRole('button', { name: new RegExp(`^${finger} ·`) })
      .click();
    await page.getByRole('button', { name: 'Set slack', exact: true }).click();
    for (let i = 0; i < 4; i++)
      await page.getByRole('button', { name: '+5°', exact: true }).click();
    await page.getByRole('button', { name: 'Set open', exact: true }).click();
  }
  await page
    .getByRole('button', { name: 'Continue to camera range', exact: true })
    .click();
  await page.evaluate(() => window.aiTherapist.calibrationFist(true));
  await page
    .getByRole('button', { name: 'Capture my fist', exact: true })
    .click();
  const opening = page.getByRole('button', {
    name: 'Glove opens the hand',
    exact: true,
  });
  await expect(opening).toBeEnabled();
  await page.evaluate(() => window.aiTherapist.calibrationFist(false));
  await opening.click();
  await page
    .getByRole('button', { name: 'Continue to review', exact: true })
    .click({ timeout: 30_000 });
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' && r.url().endsWith('/api/calibrations'),
  );
  await page
    .getByRole('button', { name: 'Save calibration', exact: true })
    .click();
  const calibration = (await (await saved).json()) as Calibration;
  expect(calibration.assist_direction).toBe('open');
  expect(calibration.servo).toHaveLength(5);
  for (const range of calibration.servo)
    expect(Math.abs(range.max_deg - range.min_deg)).toBeGreaterThanOrEqual(20);
  await page.evaluate(
    () => (
      window.aiTherapist.calibrationClock(false),
      window.aiTherapist.resetObservations()
    ),
  );
  await page
    .getByRole('button', { name: 'Start practice', exact: true })
    .click();
  const active = await page.evaluate(() =>
    window.aiTherapist.untilPhase('REST', 0),
  );
  expect(active.commands.filter((c) => c.kind === 'target')).toEqual([]);
  expect(
    active.events.filter((e) => e.event.kind === 'attempt_done'),
  ).toHaveLength(1);
  await expect(page.locator('.mx-gauge__fill--help')).toHaveCount(0);
  await page.evaluate(() => {
    window.aiTherapist.untilPulling();
    window.aiTherapist.advance(800);
  });
  await expect(page.locator('.mx-gauge__fill--help').first()).toBeVisible();
  const completed = await page.evaluate(() =>
    window.aiTherapist.untilPhase('DONE', undefined, 240_000),
  );
  await page.evaluate(() => window.aiTherapist.flush());
  await expect(
    page.getByRole('heading', { name: 'Session complete', exact: true }),
  ).toBeVisible();
  const targets = completed.commands.filter((c) => c.kind === 'target');
  expect(targets.length).toBeGreaterThan(0);
  expect(
    targets.every(
      (c) => c.pose === 'open' && c.f!.every((p) => p <= MAX_ASSIST_PULL),
    ),
  ).toBe(true);
  expect(completed.firmware.position).toEqual([0, 0, 0, 0, 0]);
  const detail = (await (
    await page.request.get(`/api/sessions/${completed.view.sessionId}`)
  ).json()) as SessionDetail;
  expect(detail.assist_direction).toBe('open');
  expect(detail.attempts.map((a) => a.pose)).toEqual(
    DEFAULT_PLAN.map((p) => p.pose),
  );
  expect(
    detail.attempts
      .filter((a) => a.pose === 'full_fist')
      .every((a) => !a.assisted),
  ).toBe(true);
  expect(
    detail.attempts.filter((a) => a.pose === 'open').every((a) => a.assisted),
  ).toBe(true);
  await page.goto('/history?tab=sessions');
  await expect(
    page.locator(`a[href="/history/sessions/${detail.id}"]`),
  ).toBeVisible();
  await expect(
    page.getByText('Earlier closing-assist glove', { exact: false }).first(),
  ).toBeVisible();
  await page.goto('/doctor');
  await page.getByText('Details', { exact: true }).click();
  await expect(
    page.getByText('Earlier closing-assist glove', { exact: false }).first(),
  ).toBeVisible();
});

test('physical STOP during an assisted opening pauses, unwinds to slack and persists the interruption', async ({
  page,
}) => {
  await silenceCoach(page);
  await page.goto('/e2e/ai-therapist.html');
  await page
    .getByRole('button', { name: 'Calibrate simulator', exact: true })
    .click();
  await page.getByRole('link', { name: 'Continue to practice' }).click();
  await page
    .getByRole('button', { name: 'Open only, 1 rep', exact: true })
    .click();
  await page.evaluate(() => window.aiTherapist.advance(200));
  await page
    .getByRole('button', { name: 'Start practice', exact: true })
    .click();
  const pulling = await page.evaluate(() => window.aiTherapist.untilPulling());
  expect(pulling.firmware.position.some((p) => p > 0.4)).toBe(true);
  const stopped = await page.evaluate(() => {
    window.aiTherapist.physicalStop(true);
    return window.aiTherapist.advance(1000);
  });
  expect(stopped.view.phase).toBe('PAUSED');
  expect(stopped.firmware.mode).toBe('none');
  expect(stopped.firmware.position).toEqual([0, 0, 0, 0, 0]);
  expect(stopped.firmware.attached.every((a) => !a)).toBe(true);
  const safety = page.locator('#safety-banner-slot').getByRole('alert');
  await expect(safety).toBeVisible();
  await expect(
    safety.getByRole('button', { name: 'Resume', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'End session', exact: true })
    .click();
  await page.evaluate(() => window.aiTherapist.flush());
  const detail = (await (
    await page.request.get(`/api/sessions/${stopped.view.sessionId}`)
  ).json()) as SessionDetail;
  expect(detail.attempts).toHaveLength(1);
  expect(detail.attempts[0]).toMatchObject({
    interrupted: true,
    assisted: true,
  });
  expect(detail.attempts[0].safety_events).toContainEqual(
    expect.objectContaining({ source: 'stop_button' }),
  );
});
