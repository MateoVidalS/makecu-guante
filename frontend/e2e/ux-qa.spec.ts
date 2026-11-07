import { test, expect, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { calibrateSimulator, silenceCoach } from './helpers';

async function inspect(page: Page, name: string, testInfo: TestInfo) {
  await expect(page.locator('main')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // Wait for the React query result/3D canvas to settle before recording the page.
  await expect(page.getByText('Loading…', { exact: true })).toHaveCount(0);
  const report = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  const serious = report.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  await testInfo.attach(`${name}-axe.json`, {
    body: JSON.stringify(report.violations, null, 2),
    contentType: 'application/json',
  });
  expect(
    serious,
    `${name}: ${serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`).join('\n')}`,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    `${name} horizontal overflow`,
  ).toBe(true);
  const directory =
    process.env.REHAB_QA_SCREENSHOTS === '1'
      ? resolve('../docs/design/screenshots/after-wp11')
      : testInfo.outputDir;
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: resolve(
      directory,
      `${testInfo.title.replaceAll(' ', '-')}-${name}.png`,
    ),
    fullPage: true,
  });
}

for (const size of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`UX ${size.width} ${theme}`, async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setViewportSize(size);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await silenceCoach(page);
      await calibrateSimulator(page);
      const sessions = (await (
        await page.request.get('/api/sessions')
      ).json()) as { id: number; is_demo: boolean; n_attempts: number }[];
      const evaluations = (await (
        await page.request.get('/api/evaluations')
      ).json()) as { id: number; is_demo: boolean }[];
      const session = sessions.find((s) => s.is_demo && s.n_attempts === 15)!;
      const evaluation = evaluations.find((e) => e.is_demo)!;
      expect(
        session,
        'Engine-generated demo sessions are seeded by the E2E server',
      ).toBeTruthy();
      const routes = [
        ['/', 'home'],
        ['/setup', 'setup'],
        ['/calibrate', 'calibrate'],
        ['/exercise', 'exercise-plan'],
        ['/evaluate', 'evaluate-preflight'],
        ['/history', 'history'],
        [`/history/sessions/${session.id}`, 'session-replay'],
        [`/history/evaluations/${evaluation.id}`, 'evaluation-detail'],
        ['/doctor', 'doctor'],
        ['/profile', 'profile'],
      ];
      for (const [url, name] of routes) {
        await page.goto(url);
        await inspect(page, name, testInfo);
      }
      await page.goto('/exercise');
      await page
        .getByRole('button', { name: 'Start practice', exact: true })
        .click();
      await expect(page.locator('.focus')).toBeVisible();
      await inspect(page, 'exercise-live', testInfo);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight,
        ),
        'Live exercise fits the patient viewport',
      ).toBe(true);
      const sizes = await page.evaluate(() => {
        const height = (selector: string) =>
          document.querySelector(selector)?.getBoundingClientRect().height ?? 0;
        const font = (selector: string) =>
          parseFloat(
            getComputedStyle(document.querySelector(selector)!).fontSize,
          );
        return {
          pause: height('.live-hero button'),
          instruction: font('.instruction'),
          phase: font('.phase-ring strong'),
        };
      });
      expect(sizes.pause).toBeGreaterThanOrEqual(64);
      expect(sizes.instruction).toBeGreaterThanOrEqual(48);
      expect(sizes.phase).toBeGreaterThanOrEqual(28);
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await inspect(page, 'exercise-paused', testInfo);
      // Reduced-motion mode should leave no running CSS animations/transitions.
      expect(
        await page.evaluate(
          () =>
            document.getAnimations().filter((a) => a.playState === 'running')
              .length,
        ),
      ).toBe(0);
      await page
        .getByRole('button', { name: 'End session', exact: true })
        .click();
      await expect(
        page.getByRole('heading', { name: 'Session complete', exact: true }),
      ).toBeVisible();
      await inspect(page, 'exercise-summary', testInfo);
      await page.goto('/doctor');
      await page.emulateMedia({ media: 'print' });
      await expect(
        page.getByText('Demo data', { exact: false }).first(),
      ).toBeVisible();
      await inspect(page, 'doctor-print', testInfo);
      expect(errors).toEqual([]);
    });
  }
}
