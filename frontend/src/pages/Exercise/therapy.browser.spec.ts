import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
for (const theme of ['light', 'dark']) {
  test(`live practice keeps Brake and audit visible without scrolling (${theme})`, async ({
    page,
  }, info) => {
    await page.addInitScript((theme) => {
      localStorage.setItem('rehab-hub.theme', theme);
    }, theme);
    await page.goto('/calibrate');
    await page
      .getByRole('button', { name: 'Calibrate simulator', exact: true })
      .click();
    await expect(
      page.getByText('Simulator calibrated.', { exact: false }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Continue to practice' }).click();
    await page
      .getByRole('button', { name: 'Start practice', exact: true })
      .click();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Coach decisions' }),
    ).toBeVisible();
    const bounds = await page.evaluate(() => {
      const hand = document
        .querySelector('.live-hero')!
        .getBoundingClientRect();
      const layout = document
        .querySelector('.live-layout')!
        .getBoundingClientRect();
      return {
        height: document.documentElement.scrollHeight,
        width: document.documentElement.scrollWidth,
        viewport: innerHeight,
        handRatio: hand.width / layout.width,
      };
    });
    expect(bounds.height).toBeLessThanOrEqual(bounds.viewport);
    expect(bounds.width).toBeLessThanOrEqual(1280);
    expect(bounds.handRatio).toBeGreaterThanOrEqual(0.55);
    for (const name of ['Brake', 'Resume', 'How I feel', 'Undo', 'Timeline']) {
      const box = await page
        .getByRole('button', { name, exact: true })
        .boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(64);
      expect(box!.y + box!.height).toBeLessThanOrEqual(720);
    }
    await page.screenshot({ path: info.outputPath(`live-${theme}.png`) });
    await page.getByRole('button', { name: 'Brake', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Resume', exact: true }).first(),
    ).toBeVisible();
  });
  test(`check-in, immediate pain brake, audit, Undo and keyboard access (${theme})`, async ({
    page,
  }, info) => {
    await page.goto('/src/pages/Exercise/therapy-harness.html');
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await expect(
      page.getByRole('button', { name: 'Undo', exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'How I feel', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const group = page.getByRole('group', { name: 'Fatigue from 0 to 10' });
    for (const button of await group.getByRole('button').all()) {
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(64);
      expect(box!.height).toBeGreaterThanOrEqual(64);
      expect(box!.y + box!.height).toBeLessThanOrEqual(720);
    }
    await group.getByRole('button', { name: '6', exact: true }).click();
    await page.screenshot({ path: info.outputPath(`check-in-${theme}.png`) });
    const axe = await new AxeBuilder({ page }).analyze();
    expect(
      axe.violations.filter((v) =>
        ['serious', 'critical'].includes(v.impact ?? ''),
      ),
    ).toEqual([]);
    await page
      .getByRole('group', { name: 'Pain from 0 to 10' })
      .getByRole('button', { name: '5', exact: true })
      .click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(
      page.getByText('Glove released. Practice paused.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Timeline', exact: true }).click();
    await expect(
      page.getByRole('dialog').getByText('Pain 5/10 · Fatigue 6/10'),
    ).toBeVisible();
    await expect(
      page
        .getByRole('dialog')
        .getByText('Brake · glove released', { exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', { name: 'Timeline', exact: true }),
    ).toBeFocused();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Undo', exact: true }),
    ).toBeDisabled();
    await page
      .getByRole('button', { name: 'Test coach decision', exact: true })
      .click();
    await expect(page.getByText(/Rest added.*Time to rest/)).toBeVisible();
    expect(errors).toEqual([]);
  });
}
