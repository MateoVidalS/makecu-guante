import { test, expect } from '@playwright/test';
import { calibrateSimulator, silenceCoach } from './helpers';
import type { SessionDetail } from '../src/contracts/api';

test('the header simulator menu produces and saves a ring resistance stop', async ({
  page,
}) => {
  test.setTimeout(45_000);
  await silenceCoach(page);
  await calibrateSimulator(page);
  await page
    .getByRole('button', { name: 'Fist only, 1 rep', exact: true })
    .click();
  await page.getByText('Demo recovery', { exact: true }).click();
  await page.getByLabel('Patient preset', { exact: true }).selectOption('mild');
  await page.getByLabel('Rigid finger', { exact: true }).selectOption('ring');
  await page.getByRole('checkbox', { name: 'Rigid ring', exact: true }).check();
  await page.getByText('Demo recovery', { exact: true }).click();
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/api/sessions'),
  );
  await page
    .getByRole('button', { name: 'Start practice', exact: true })
    .click();
  const sessionId = (await (await created).json()).id as number;
  await expect(
    page.getByRole('heading', { name: 'Session complete', exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole('status', { name: 'Session saving status' }),
  ).toHaveText('Saved');
  const detail = (await (
    await page.request.get(`/api/sessions/${sessionId}`)
  ).json()) as SessionDetail;
  expect(detail.attempts).toHaveLength(1);
  expect(detail.attempts[0].safety_events).toContainEqual(
    expect.objectContaining({ source: 'resistance', finger: 'ring' }),
  );
  expect(detail.attempts[0].fingers.every((finger) => finger.scored)).toBe(
    true,
  );
  expect(detail.is_demo).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __spoken: string[] }).__spoken.join('\n'),
      ),
    )
    .toContain('Stopping. I felt resistance in your ring');
});
