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
    expect(detail.summary?.attempts).toBe(15);
    await route.fulfill({
      json: {
        id: 1,
        kind: 'session',
        created_at: new Date().toISOString(),
        session_id: body.session_id,
        days: null,
        model: 'e2e-mocked-gemini',
        text: 'You completed 15 attempts. Good effort today.',
      },
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
  await page
    .getByLabel('Voice mode', { exact: true })
    .first()
    .selectOption('off');
  await page.getByText('Simulator controls', { exact: true }).click();
  await page
    .getByRole('checkbox', { name: 'Rigid index', exact: true })
    .check();
  const safety = page.getByRole('alert', { name: 'Safety stop' });
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
    .toContain('Stopping. I felt resistance in your index.');
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
  await expect(page.getByText('15 attempts', { exact: false })).toBeVisible();
  await expect(
    page.getByText('You completed 15 attempts. Good effort today.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('status', { name: 'Session saving status' }),
  ).toHaveText('Saved');
  const stored = await page.request.get(`/api/sessions/${sessionId}`);
  const detail = (await stored.json()) as SessionDetail;
  expect(detail.attempts).toHaveLength(15);
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
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  await page.locator(`a[href="/history/sessions/${sessionId}"]`).click();
  await expect(
    page.getByRole('heading', { name: 'Session replay', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('img', { name: /Your attempt, moment by moment/ }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Attempt', { exact: true }).locator('option'),
  ).toHaveCount(15);
  await page.goto('/evaluate');
  await page
    .getByRole('checkbox', { name: 'Hand relaxed in the glove' })
    .check();
  await expect(
    page.getByRole('checkbox', { name: 'Calibrated', exact: true }),
  ).toBeEnabled();
  await page.getByRole('checkbox', { name: 'Calibrated', exact: true }).check();
  await page
    .getByRole('checkbox', { name: 'Glove connected', exact: true })
    .check();
  await page
    .getByRole('button', { name: 'Start evaluation', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Your evaluation', exact: true }),
  ).toBeVisible({ timeout: 45_000 });
  await expect(
    page.getByRole('status', { name: 'Session saving status' }),
  ).toHaveText('Saved');
  await page.goto('/doctor');
  await expect(
    page.getByRole('heading', { name: 'Doctor view', exact: true }),
  ).toBeVisible();
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
