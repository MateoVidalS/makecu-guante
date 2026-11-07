import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const screenshots = fileURLToPath(
  new URL(
    '../../../../docs/design/screenshots/five-fingers-live/',
    import.meta.url,
  ),
);
mkdirSync(screenshots, { recursive: true });
async function calibrated(page: Page) {
  await page.goto('/calibrate');
  await page
    .getByRole('button', { name: 'Calibrate simulator', exact: true })
    .click();
  await page.getByRole('link', { name: 'Continue to practice' }).click();
}
async function fits(page: Page) {
  const geometry = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    width: document.documentElement.scrollWidth,
    viewportHeight: innerHeight,
    viewportWidth: innerWidth,
    instruction: parseFloat(
      getComputedStyle(document.querySelector('.instruction')!).fontSize,
    ),
    phase: parseFloat(
      getComputedStyle(document.querySelector('.phase-ring strong')!).fontSize,
    ),
    gauges: [...document.querySelectorAll('.mx-gauge')].map((g) => ({
      valueSize: parseFloat(
        getComputedStyle(g.querySelector('.mx-gauge__value')!).fontSize,
      ),
      box: g.getBoundingClientRect().toJSON(),
      value: g
        .querySelector('.mx-gauge__value')!
        .getBoundingClientRect()
        .toJSON(),
    })),
  }));
  expect(geometry.height).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.width).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.instruction).toBeGreaterThanOrEqual(48);
  expect(geometry.phase).toBeGreaterThanOrEqual(28);
  expect(geometry.gauges).toHaveLength(5);
  for (const gauge of geometry.gauges) {
    expect(gauge.valueSize).toBeGreaterThanOrEqual(24);
    expect(gauge.value.right).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(gauge.box.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
  }
  for (const name of ['Resume', 'Skip pose']) {
    const box = await page
      .getByRole('button', { name, exact: true })
      .boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(64);
    expect(box!.y + box!.height).toBeLessThanOrEqual(geometry.viewportHeight);
  }
}
for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
]) {
  for (const theme of ['light', 'dark']) {
    test(`five-finger live UI ${viewport.width}x${viewport.height} ${theme}`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(
        (value) => localStorage.setItem('rehab-hub.theme', value),
        theme,
      );
      const shot = async (name: string, fullPage = false) => {
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({
          path: `${screenshots}/${name}-${theme}-${viewport.width}x${viewport.height}.png`,
          fullPage,
        });
      };
      await page.goto('/');
      await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
      await shot('home');
      await page.goto('/setup');
      await expect(
        page.getByRole('heading', { name: 'Glove-detection check' }),
      ).toBeVisible();
      await expect(page.getByText(/Hand detected:.*last 5 s/)).toBeVisible({
        timeout: 15000,
      });
      await shot('setup');
      await shot('setup-full', true);
      await page.getByText('Glove diagnostics', { exact: true }).click();
      for (const name of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'])
        await expect(
          page
            .getByRole('region', { name: 'Glove ready' })
            .locator('dt')
            .getByText(name, { exact: true }),
        ).toHaveCount(1);
      await page.goto('/calibrate');
      await shot('calibrate');
      for (const name of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'])
        await expect(
          page.getByRole('button', { name: new RegExp(`^${name} ·`) }),
        ).toBeVisible();
      await page.goto('/evaluate');
      await expect(page.getByText(/10 sweeps/)).toBeVisible();
      await shot('evaluate');
      await calibrated(page);
      await page
        .getByRole('button', { name: 'Short session', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Start practice', exact: true })
        .click();
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Resume', exact: true }),
      ).toBeVisible();
      await expect(page.locator('.hand-view')).toHaveAttribute(
        'aria-label',
        /Palm down, right hand/,
      );
      await fits(page);
      await shot('exercise-live');
      await page.getByRole('button', { name: 'Resume', exact: true }).click();
      await expect(page.locator('.attempt-toast')).toBeVisible({
        timeout: 30000,
      });
      await shot('exercise-feedback');
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await fits(page);
      await page
        .getByRole('button', { name: 'End session', exact: true })
        .click();
    });
  }
}

test('selected ring/pinky evaluation uses four sweeps', async ({ page }) => {
  await calibrated(page);
  await page.goto('/evaluate');
  for (const name of ['Thumb', 'Index', 'Middle'])
    await page.getByRole('checkbox', { name, exact: true }).uncheck();
  await expect(page.getByText(/4 sweeps/)).toBeVisible();
  await page
    .getByRole('checkbox', { name: 'Hand relaxed in the glove' })
    .check();
  await page
    .getByRole('button', { name: 'Start evaluation', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Measuring ring' }),
  ).toBeVisible();
  await expect(page.getByText(/Sweep 1 of 4/)).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Evaluation steps' }).locator('li'),
  ).toHaveCount(4);
  await page.getByRole('button', { name: 'Stop evaluation' }).click();
});
