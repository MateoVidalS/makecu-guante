import { calibration } from '../../contracts/fixtures.check';
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const screenshots = fileURLToPath(
  new URL('../../../../docs/design/screenshots/simplify/', import.meta.url),
);
mkdirSync(screenshots, { recursive: true });

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
]) {
  test(`simplified live flows ${viewport.width}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const shot = async (name: string) => {
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        return document.fonts.ready;
      });
      await page.screenshot({
        path: `${screenshots}/s1-${name}-${viewport.width}.png`,
        fullPage: true,
      });
    };
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('.app-nav a')).toHaveText([
      'Home',
      'History',
      'Setup',
    ]);
    await expect(
      page.getByRole('link', { name: 'Profile', exact: true }),
    ).toBeVisible();
    await shot('home');
    await page.goto('/setup');
    await expect(page.getByText('Advanced', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Disconnect', exact: true }),
    ).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Release glove', exact: true }),
    ).toBeVisible();
    await shot('setup');
    await page.goto('/calibrate');
    await expect(
      page
        .getByRole('navigation', { name: 'Calibration steps' })
        .getByRole('listitem'),
    ).toHaveCount(3);
    await shot('calibrate-range');
    for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
      await page.getByLabel('Servo angle', { exact: true }).fill('20');
      await page.getByRole('button', { name: 'Set open', exact: true }).click();
      await page.getByLabel('Servo angle', { exact: true }).fill('150');
      await page
        .getByRole('button', { name: 'Set closed', exact: true })
        .click();
      await page
        .getByRole('button', {
          name: finger === 'Pinky' ? 'Continue to camera range' : 'Next finger',
          exact: true,
        })
        .click();
    }
    await expect(
      page.getByRole('heading', { name: 'Step 2 · Camera range' }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Capture open hand', exact: true })
      .click();
    await expect(page.getByText('Captured', { exact: true })).toHaveCount(1, {
      timeout: 10000,
    });
    await expect(
      page.getByRole('button', { name: 'Glove closes the hand', exact: true }),
    ).toBeEnabled();
    await shot('calibrate-camera');
    // Resume Review from known capture fixtures. Simulated camera jitter deliberately
    // remains subject to the same movement rejection as a physical camera.
    await page.evaluate((camera) => {
      const draft = JSON.parse(sessionStorage.getItem('rehab-calibration')!);
      sessionStorage.setItem(
        'rehab-calibration',
        JSON.stringify({
          ...draft,
          step: 2,
          open: { raw: camera.open_flex, pinch: camera.pinch_open },
          closed: { raw: camera.closed_flex, pinch: camera.pinch_closed },
        }),
      );
    }, calibration.camera);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Review your range', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('spinbutton')).toHaveCount(0);
    await shot('calibrate-review');
    await page
      .getByRole('button', { name: 'Save calibration', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Your range is saved' }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Start practice', exact: true })
      .click();
    await expect(page.locator('.focus')).toBeVisible();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(
      page.getByRole('switch', { name: 'Show camera' }),
    ).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('switch', { name: 'Microphone' })).toHaveCount(
      0,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight,
      ),
    ).toBe(true);
    await shot('exercise-live');
    await page.getByRole('switch', { name: 'Show camera' }).click();
    await shot('exercise-camera');
    await page.getByText('Demo recovery', { exact: true }).click();
    await page
      .getByRole('button', { name: 'Press simulated STOP', exact: true })
      .click();
    const safety = page.locator('#safety-banner-slot [role=alert]');
    await expect(safety).toBeVisible();
    await expect(
      safety.getByRole('button', { name: 'Resume', exact: true }),
    ).toBeFocused();
    await expect(page.locator('.runtime-fallback')).not.toHaveAttribute('open');
    await page.getByText('Demo recovery', { exact: true }).click();
    const bannerBox = (await safety.boundingBox())!;
    const menuBox = (await page
      .locator('.runtime-fallback__panel')
      .boundingBox())!;
    expect(menuBox.y).toBeGreaterThanOrEqual(bannerBox.y + bannerBox.height);
    await shot('safety-menu');
    await page
      .getByRole('button', { name: 'Release simulated STOP', exact: true })
      .click();
    await page.getByText('Demo recovery', { exact: true }).click();
    await safety.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(safety).not.toBeVisible();
    await page
      .getByRole('button', { name: 'End session', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('button', { name: 'Keep practicing' }),
    ).toBeFocused();
    await dialog
      .getByRole('button', { name: 'End session', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Session complete' }),
    ).toBeVisible();
    await shot('summary');
    await page
      .getByRole('button', { name: 'Practice again', exact: true })
      .click();
    await shot('customize-plan');
  });
}
