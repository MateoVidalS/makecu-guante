import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
const qaDir = fileURLToPath(
  new URL('../../../../docs/design/screenshots/after-wp12/', import.meta.url),
);
mkdirSync(qaDir, { recursive: true });
async function calibrate(page: Page) {
  await page.goto('/calibrate');
  await page
    .getByRole('button', { name: 'Calibrate simulator', exact: true })
    .click();
  await expect(
    page.getByText('Simulator calibrated.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Continue to practice' }).click();
}
for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`all pages and live layout ${viewport.width} ${theme}`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (e) => {
        if (e.type() === 'error') errors.push(e.text());
      });
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      const capture = async (name: string, fullPage = true) => {
        await expect(page.locator('main h1')).toBeVisible();
        await expect(page.getByText('Loading your records…')).toHaveCount(0);
        await expect(
          page.getByText('Loading chart…', { exact: true }),
        ).toHaveCount(0);
        await page.evaluate(() => document.fonts.ready);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect(
          await page.locator('main .ds-button--primary:visible').count(),
        ).toBeLessThanOrEqual(1);
        await page.screenshot({
          path: `${qaDir}/${name}-${theme}-${viewport.width}.png`,
          fullPage,
        });
      };
      await page.goto('/_dev/design');
      await expect(
        page.getByRole('heading', { name: 'Design system', exact: true }),
      ).toBeVisible();
      for (const [route, name] of [
        ['/', 'home'],
        ['/setup', 'setup'],
        ['/calibrate', 'calibrate'],
        ['/exercise', 'exercise-plan'],
        ['/evaluate', 'evaluate'],
        ['/history', 'history'],
        ['/history?tab=active%20range', 'history-active-range'],
        ['/history?tab=assistance', 'history-assistance'],
        ['/history?tab=resistance', 'history-resistance'],
        ['/history?tab=sessions', 'history-sessions'],
        ['/history/sessions/8', 'session-replay'],
        ['/history/evaluations/1', 'evaluation-detail'],
        ['/doctor', 'doctor'],
        ['/profile', 'profile'],
      ]) {
        await page.goto(route);
        await capture(name);
        if (name === 'evaluation-detail') {
          for (const card of await page.locator('.chart-card').all())
            await expect(
              card.locator('.ds-badge').getByText('Demo data', { exact: true }),
            ).toHaveCount(1);
        }
        if (name === 'session-replay') {
          await page
            .getByRole('button', { name: 'Delete session', exact: true })
            .click();
          const dialog = page.getByRole('dialog');
          await expect(
            dialog.getByRole('button', { name: 'Keep session' }),
          ).toBeFocused();
          await expect(
            dialog.getByRole('button', { name: 'Confirm delete' }),
          ).toHaveClass(/ds-button--danger/);
          await capture('delete-dialog');
          await page.keyboard.press('Escape');
          await expect(dialog).not.toBeVisible();
          await expect(
            page.getByRole('button', { name: 'Delete session', exact: true }),
          ).toBeFocused();
        }
      }
      await calibrate(page);
      await page
        .getByRole('button', { name: 'Start practice', exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: 'Pause', exact: true }),
      ).toBeVisible();
      // The real runtime remains active while we inspect its natural layout.
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await expect(
        page.locator('.statuses').getByText('Paused', { exact: true }),
      ).toBeVisible();
      await expect(
        page.locator('.statuses .ds-status-chip--danger'),
      ).toHaveCount(0);
      const geometry = await page.evaluate(() => ({
        height: document.documentElement.scrollHeight,
        viewport: innerHeight,
        hand: document.querySelector('.live-hero')!.getBoundingClientRect()
          .width,
        width: document.querySelector('.live-layout')!.getBoundingClientRect()
          .width,
        instruction: parseFloat(
          getComputedStyle(document.querySelector('.instruction')!).fontSize,
        ),
      }));
      expect(geometry.height).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.hand / geometry.width).toBeGreaterThanOrEqual(0.55);
      expect(geometry.instruction).toBeGreaterThanOrEqual(48);
      await expect(
        page.getByRole('button', { name: 'End practice', exact: true }),
      ).toHaveCount(0);
      for (const name of ['Resume', 'Skip pose']) {
        const box = await page
          .getByRole('button', { name, exact: true })
          .boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(64);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      }
      await capture('exercise-live', false);
      await page.getByText('Coach controls', { exact: true }).click();
      await expect(
        page.getByRole('switch', { name: 'Mic on' }).last(),
      ).toBeVisible();
      await expect(page.getByLabel('Voice mode')).toBeVisible();
      await page.getByText('Coach controls', { exact: true }).click();
      await page
        .getByRole('button', { name: 'End session', exact: true })
        .click();
      await capture('exercise-summary');
      expect(errors).toEqual([]);
    });
  }
}

test('helper calibration captures values and uses one release action', async ({
  page,
}) => {
  await page.goto('/calibrate');
  await expect(page.getByRole('button', { name: /Release glove/ })).toHaveCount(
    1,
  );
  for (const finger of ['Thumb', 'Index', 'Middle']) {
    await page
      .getByRole('button', { name: new RegExp(`^${finger} ·`) })
      .click();
    await page.getByLabel('Servo angle').fill('20');
    await page.getByRole('button', { name: /^Set open/ }).click();
    await page.getByLabel('Servo angle').fill('150');
    await page.getByRole('button', { name: /^Set closed/ }).click();
    await expect(
      page.getByRole('button', { name: 'Set open ✓ 20°' }),
    ).toBeVisible();
  }
  await page.getByRole('button', { name: 'Send glove ranges' }).click();
  await page.getByRole('button', { name: /Use example camera range/ }).click();
  await page.getByRole('button', { name: 'Continue to friction' }).click();
  await page.getByRole('button', { name: 'Skip friction measurement' }).click();
  await page.getByRole('button', { name: 'Save calibration' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your range is saved' }),
  ).toBeVisible();
});
