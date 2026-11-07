import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const routes = [
  '/history',
  '/history?tab=active%20range',
  '/history?tab=assistance',
  '/history?tab=resistance',
  '/history?tab=sessions',
  '/history/sessions/8',
  '/history/evaluations/3',
  '/doctor',
  '/profile',
];
test('all data views render without console errors across patient sizes and themes', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      for (const route of routes) {
        await page.goto(route);
        await expect(page.locator('h1')).toBeVisible();
        await expect(page.getByText('Loading your records…')).toHaveCount(0);
        await expect(page.getByText('Loading chart…')).toHaveCount(0);
        await expect(page.getByRole('alert')).toHaveCount(0);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: info.outputPath(
            `${route.replace(/[^a-z0-9]/gi, '-')}-${colorScheme}-${viewport.width}.png`,
          ),
          fullPage: true,
        });
      }
    }
  }
  expect(errors).toEqual([]);
});
test('history exposes fixture improvement and chart data with demo labels', async ({
  page,
}) => {
  await page.goto('/history');
  await expect(page.getByText('37% → 65%')).toBeVisible();
  await page.getByRole('tab', { name: 'Active range', exact: true }).click();
  await page.getByLabel('Pose').selectOption('full_fist');
  await page.getByText('Show as table', { exact: true }).nth(1).click();
  const table = page.getByRole('table');
  await expect(table).toContainText('37%');
  await expect(table).toContainText('65%');
  await expect(table).toContainText('Demo data');
  await expect(page.locator('.recharts-line-curve')).toHaveCount(3);
});
test('profile persists, therapist summary generates, and exports contain demo flags', async ({
  page,
}) => {
  await page.goto('/profile');
  await expect(page.getByLabel('Pseudonym')).toBeVisible();
  await page.getByLabel('Pseudonym').fill('Browser review');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();
  // Navigate within the app to keep the in-memory mock store alive.
  await page.getByRole('link', { name: 'Doctor view', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Browser review' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Generate (last 7 days)' }).click();
  await expect(
    page.getByRole('button', { name: 'Generate (last 7 days)' }),
  ).toBeEnabled();
  for (const format of ['JSON', 'CSV']) {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: `Export ${format}` }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(
      `rehab-hub.${format.toLowerCase()}`,
    );
    const payload = await readFile((await download.path())!, 'utf8');
    expect(payload).toContain('is_demo');
  }
});
test('doctor report exports A4 and Letter with white pages and indivisible charts', async ({
  page,
}, info) => {
  await page.goto('/doctor');
  await expect(page.locator('.recharts-line-curve')).toHaveCount(18);
  await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
  await expect(page.locator('.doctor-banner')).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Print / Save PDF' }),
  ).toBeHidden();
  expect(
    await page
      .locator('.doctor')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe('rgb(255, 255, 255)');
  for (const format of ['A4', 'Letter'] as const) {
    const path = info.outputPath(`doctor-${format.toLowerCase()}.pdf`);
    expect(
      await page.locator('.recharts-surface').evaluateAll((charts) =>
        charts.every((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 600 && rect.width < 720 && rect.height > 100;
        }),
      ),
    ).toBe(true);
    await page.pdf({ path, format, printBackground: true });
    const pdf = await readFile(path);
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(4);
    await info.attach(`Doctor ${format} print`, {
      path,
      contentType: 'application/pdf',
    });
  }
  expect(
    await page
      .locator('.chart-card')
      .evaluateAll((cards) =>
        cards.every((el) => getComputedStyle(el).breakInside === 'avoid'),
      ),
  ).toBe(true);
});
