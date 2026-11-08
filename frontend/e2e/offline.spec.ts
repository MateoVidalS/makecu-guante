import { test, expect } from '@playwright/test';
import {
  calibrateSimulator,
  silenceCoach,
  askForHelpWhenOffered,
} from './helpers';

test('finishes practice offline and saves the queued session after recovery', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await silenceCoach(page);
  await askForHelpWhenOffered(page);
  await calibrateSimulator(page);
  let offline = true;
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() === 'POST' && offline)
      await route.abort('failed');
    else await route.continue();
  });
  await page
    .getByRole('button', { name: 'Short session', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Start practice', exact: true })
    .click();
  await page.getByText('Coach controls', { exact: true }).click();
  await page.getByLabel('Voice mode').selectOption('off');
  await page.getByText('Coach controls', { exact: true }).click();
  const status = page.getByRole('status', { name: 'Session saving status' });
  await expect(status).toHaveText('Offline');
  await expect(
    page.getByRole('heading', { name: 'Session complete', exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('8 attempts', { exact: false })).toBeVisible();
  await expect(status).toHaveText('Offline');
  offline = false;
  await expect(status).toHaveText('Saved', { timeout: 10_000 });
  await page.getByRole('link', { name: 'See progress', exact: true }).click();
  await page.getByRole('tab', { name: 'Sessions', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: '10', exact: true }).first(),
  ).toBeVisible();
});
