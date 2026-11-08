import { test, expect } from '@playwright/test';
import { calibrateSimulator, silenceCoach } from './helpers';
import type { SessionDetail } from '../src/contracts/api';

test('sim calibration, full default plan, rigid-index safety, history, replay, evaluation and doctor export', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await silenceCoach(page);
  await page.route('**/api/summaries', async (route) => {
    const body = route.request().postDataJSON();
    expect(body.kind).toBe('session');
    // The UI must wait until all attempts and the end marker have reached the backend.
    const stored = await page.request.get(`/api/sessions/${body.session_id}`);
    const detail = (await stored.json()) as SessionDetail;
    expect(detail.summary?.attempts).toBe(10);
    await route.fulfill({
      json: {
        id: 1,
        kind: 'session',
        created_at: new Date().toISOString(),
        session_id: body.session_id,
        days: null,
        model: 'e2e-mocked-gemini',
        text: 'You completed 10 attempts. Good effort today.',
      },
    });
  });
  // This scenario verifies the independent hard-current fault, including its
  // latched banner, release and recovery. Keep its lower limit explicit now
  // that normal five-servo simulator calibration defaults to 1500 mA.
  await page.route('**/api/calibrations', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.continue({
      postData: JSON.stringify({
        ...route.request().postDataJSON(),
        current_limit_ma: 900,
      }),
    });
  });
  await calibrateSimulator(page);
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/api/sessions'),
  );
  await page
    .getByRole('button', { name: 'Start practice', exact: true })
    .click();
  const sessionId = (await (await created).json()).id as number;
  await expect(page.locator('.focus')).toBeVisible();
  await page.getByText('Coach controls', { exact: true }).click();
  await page.getByLabel('Voice mode').selectOption('off');
  await page.getByText('Coach controls', { exact: true }).click();
  await page.locator('.runtime-fallback').evaluate((menu) => {
    // Expose simulator fault injection only inside this test.
    (menu as HTMLElement).hidden = false;
    menu.querySelector('summary')!.click();
  });
  await page
    .getByRole('checkbox', { name: 'Rigid index', exact: true })
    .check();
  const safety = page.locator('#safety-banner-slot').getByRole('alert');
  await expect(safety).toBeVisible({ timeout: 45_000 });
  await safety.getByText('What happened?', { exact: true }).click();
  await expect(safety).toContainText('overcurrent');
  await expect(safety).toContainText('index');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __spoken: string[] }).__spoken,
      ),
    )
    .toContain("I feel resistance opening your index, let's stop here.");
  await page.locator('.runtime-fallback').evaluate((menu) => {
    // Expose simulator fault injection only inside this test.
    (menu as HTMLElement).hidden = false;
    menu.querySelector('summary')!.click();
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight,
    ),
    'Safety banner must fit without scrolling',
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('rigid-index-safety.png'),
    fullPage: true,
  });
  await page
    .getByRole('checkbox', { name: 'Rigid index', exact: true })
    .uncheck();
  await safety.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(safety).not.toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Session complete', exact: true }),
  ).toBeVisible({ timeout: 100_000 });
  await expect(page.getByText(/^10 attempts ·/)).toBeVisible();
  await expect(
    page.getByText('You completed 10 attempts. Good effort today.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('status', { name: 'Session saving status' }),
  ).toHaveText('Saved');
  const stored = await page.request.get(`/api/sessions/${sessionId}`);
  const detail = (await stored.json()) as SessionDetail;
  expect(detail.attempts).toHaveLength(10);
  const fist = detail.attempts.find((a) => a.pose === 'full_fist')!;
  expect(fist.fingers.map((f) => f.finger)).toEqual([
    'thumb',
    'index',
    'middle',
    'ring',
    'pinky',
  ]);
  expect(fist.fingers.every((f) => f.scored)).toBe(true);
  const trace = await (
    await page.request.get(`/api/attempts/${fist.id}/trace`)
  ).json();
  expect(Object.keys(trace.servo)).toEqual([
    'thumb',
    'index',
    'middle',
    'ring',
    'pinky',
  ]);
  expect(
    detail.attempts.some(
      (a) =>
        a.interrupted &&
        a.safety_events.some(
          (e) => e.source === 'overcurrent' && e.finger === 'index',
        ),
    ),
  ).toBe(true);
  expect(detail.is_demo).toBe(true);
  await page.getByRole('link', { name: 'See progress', exact: true }).click();
  await page.getByRole('tab', { name: 'Sessions', exact: true }).click();
  await page.locator(`a[href="/history/sessions/${sessionId}"]`).click();
  await expect(
    page.getByRole('heading', { name: 'Session replay', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('img', { name: /Your attempt, moment by moment/ }),
  ).toBeVisible();
  await expect(page.getByLabel('Attempt').locator('option')).toHaveCount(10);
  await page.goto('/evaluate');
  const measureFriction = page.getByRole('button', {
    name: 'Measure glove friction',
    exact: true,
  });
  if (await measureFriction.count()) {
    await page
      .getByRole('checkbox', { name: 'The glove is empty and hanging freely' })
      .check();
    await measureFriction.click();
    await expect(
      page.getByText(
        'Recent glove friction saved. Put the glove on, then relax.',
      ),
    ).toBeVisible({ timeout: 60_000 });
  }

  await page
    .getByRole('checkbox', { name: 'Hand relaxed in the glove' })
    .check();
  await expect(
    page
      .getByRole('group', { name: 'Fingers to measure' })
      .getByRole('checkbox', { checked: true }),
  ).toHaveCount(5);
  await expect(
    page.locator('main .ds-status-chip').filter({ hasText: 'Calibration:' }),
  ).toContainText('Ready');
  await expect(
    page.locator('main .ds-status-chip').filter({ hasText: 'Glove:' }),
  ).toContainText('Connected');
  const evaluated = page.waitForResponse(
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
  ).toBeVisible({ timeout: 45_000 });
  const evaluation = await (await evaluated).json();
  expect(evaluation.sweeps).toHaveLength(10);
  expect(evaluation.fingers).toHaveLength(5);
  await expect(
    page.getByRole('status', { name: 'Session saving status' }),
  ).toHaveText('Saved');
  await page.goto('/doctor');
  await expect(
    page.getByRole('heading', {
      name: 'Practice and movement report',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByText('Details', { exact: true }).click();
  await expect(
    page.getByText('Active range over sessions', { exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const exported = await download;
  expect(exported.suggestedFilename()).toBe('rehab-hub.json');
  const path = testInfo.outputPath('rehab-hub.json');
  await exported.saveAs(path);
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(path, 'utf8');
  expect(text).toContain('overcurrent');
  expect(text).toContain('evaluations');
  expect(errors).toEqual([]);
});
