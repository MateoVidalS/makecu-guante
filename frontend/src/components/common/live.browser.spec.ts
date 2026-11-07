import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
const qaDir = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(qaDir, { recursive: true });
test('mock flows run end to end and remain readable in both themes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: "Start today's practice" }),
  ).toBeVisible();
  await expect(
    page.getByText('Camera sees your hand', { exact: false }),
  ).toBeVisible();
  await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() =>
      parseFloat(getComputedStyle(document.activeElement!).outlineWidth),
    ),
  ).toBeGreaterThanOrEqual(3);
  // Home starts the default short plan; the route guard must survive StrictMode.
  await page.getByLabel('Short session (1 rep each)').check();
  await page.getByRole('button', { name: "Start today's practice" }).click();
  await expect(
    page.getByRole('button', { name: 'Pause', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Space');
  await expect(
    page.getByRole('button', { name: 'Resume', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Space');
  await expect(
    page.getByRole('button', { name: 'Pause', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Keep practicing' }).click();
  await page.getByRole('button', { name: 'End practice' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'End session' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Session complete' }),
  ).toBeVisible();
  // The scripted camera lacks raw flexion: only its explicit example option bypasses capture.
  await page.goto('/calibrate');
  for (const finger of ['Thumb', 'Index', 'Middle']) {
    await page
      .getByRole('button', { name: new RegExp(`^${finger} [○✓]`) })
      .click();
    await page.getByLabel('Servo angle').fill('20');
    await page.getByRole('button', { name: /^Set open/ }).click();
    await page.getByLabel('Servo angle').fill('150');
    await page.getByRole('button', { name: /^Set closed/ }).click();
  }
  await page.getByRole('button', { name: 'Send glove ranges' }).click();
  await page.getByRole('button', { name: /Use example camera range/ }).click();
  await page.getByRole('button', { name: 'Continue to friction' }).click();
  await page.getByLabel('The glove is off the hand').check();
  await page.getByRole('button', { name: 'Measure glove friction' }).click();
  await expect(
    page.getByRole('heading', { name: 'Review your range' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save calibration' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your range is saved' }),
  ).toBeVisible();
  await page.goto('/evaluate');
  for (const label of [
    'Hand relaxed in the glove',
    'Calibrated',
    'Glove connected',
  ])
    await page.getByLabel(label).check();
  await page.clock.install();
  await page.getByRole('button', { name: 'Start evaluation' }).click();
  await expect(
    page.getByRole('heading', { name: 'Measuring thumb' }),
  ).toBeVisible();
  await page.clock.runFor(27000);
  await expect(
    page.getByRole('heading', { name: 'Your evaluation' }),
  ).toBeVisible();
  // Capture each live page at both required sizes and themes.
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(size);
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      for (const [route, name] of [
        ['/', 'home'],
        ['/setup', 'setup'],
        ['/calibrate', 'calibrate'],
        ['/evaluate', 'evaluate'],
        ['/exercise', 'exercise-plan'],
      ] as const) {
        await page.goto(route);
        await expect(page.locator('main h1')).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: `${qaDir}/${name}-${theme}-${size.width}.png`,
          fullPage: true,
        });
      }
      await page.getByRole('button', { name: 'Start practice' }).click();
      await expect(
        page.getByRole('button', { name: 'Pause', exact: true }),
      ).toBeVisible();
      await page.clock.runFor(3500);
      const instruction = page.locator('.instruction'),
        phase = page.locator('.phase-ring strong');
      expect(
        await instruction.evaluate((e) =>
          parseFloat(getComputedStyle(e).fontSize),
        ),
      ).toBeGreaterThanOrEqual(48);
      expect(
        await phase.evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
      ).toBeGreaterThanOrEqual(28);
      expect(
        await page
          .locator('.finger strong')
          .first()
          .evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
      ).toBeGreaterThanOrEqual(24);
      for (const button of await page.locator('main button').all())
        expect(
          await button.evaluate((e) => e.getBoundingClientRect().height),
        ).toBeGreaterThanOrEqual(64);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        (await page
          .getByRole('button', { name: 'End practice' })
          .boundingBox())!.y + 64,
      ).toBeLessThanOrEqual(size.height);
      await page.screenshot({
        path: `${qaDir}/exercise-live-${theme}-${size.width}.png`,
        fullPage: true,
      });
      await page.getByRole('button', { name: 'End practice' }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'End session' })
        .click();
      await expect(
        page.getByRole('heading', { name: 'Session complete' }),
      ).toBeVisible();
      await page.screenshot({
        path: `${qaDir}/exercise-summary-${theme}-${size.width}.png`,
        fullPage: true,
      });
    }
  }
  expect(errors).toEqual([]);
});
