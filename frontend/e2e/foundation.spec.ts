import { test, expect } from '@playwright/test';
import { calibrateSimulator, silenceCoach } from './helpers';
const routes: [string, string | RegExp][] = [
  ['/', /^Hello/],
  ['/setup', 'Connect glove and camera'],
  ['/calibrate', 'Find your comfortable range'],
  ['/exercise', 'Your practice'],
  ['/evaluate', 'Check your comfortable movement'],
  ['/history', 'History'],
  ['/history/sessions/8', 'Session replay'],
  ['/history/evaluations/3', 'Evaluation detail'],
  ['/doctor', 'Doctor view'],
  ['/profile', 'Profile'],
  ['/_dev/hand', 'Virtual hand gallery'],
];
test('every route renders with its shell and accessibility slots', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const [route, title] of routes) {
    await page.goto(route);
    await expect(
      page.getByRole('heading', { name: title, exact: true }),
    ).toBeVisible();
    await expect(page.locator('#safety-banner-slot')).toHaveCount(1);
  }
  expect(errors).toEqual([]);
});
test('real exercise enters focus, pauses and ends safely', async ({ page }) => {
  await silenceCoach(page);
  await calibrateSimulator(page);
  await page
    .getByRole('button', { name: 'Start practice', exact: true })
    .click();
  await expect(page.locator('.focus')).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Resume', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('button', { name: 'End practice', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'End session', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Session complete', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('navigation')).toBeVisible();
});

test('browser health and mock writes use the configured API', async ({
  page,
}) => {
  await page.goto('/');
  const health = await page.request.get('/api/health');
  expect(health.ok()).toBe(true);
  if (process.env.REHAB_E2E_MOCK === '1') {
    const value = await page.evaluate(async () => {
      const profile = await (await fetch('/api/profile')).json();
      await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...profile, pseudonym: 'Browser test' }),
      });
      return (await (await fetch('/api/profile')).json()).pseudonym;
    });
    expect(value).toBe('Browser test');
  }
});

test('theme tokens and page layout at patient viewport sizes', async ({
  page,
}, testInfo) => {
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(size);
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto('/');
      await expect(page.getByRole('heading', { name: /^Hello/ })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      expect(
        await page
          .locator('button, .button')
          .first()
          .evaluate((el) => el.getBoundingClientRect().height),
      ).toBeGreaterThanOrEqual(64);
      await page.screenshot({
        path: testInfo.outputPath(`home-${theme}-${size.width}.png`),
        fullPage: true,
      });
    }
  }
});
