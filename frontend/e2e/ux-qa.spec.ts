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
  for (const link of await page.locator('.app-nav a').all()) {
    expect(
      await link.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ),
        );
      }),
      'Header navigation must not be covered by status or recovery tools',
    ).toBe(true);
  }
  const directory =
    process.env.REHAB_QA_SCREENSHOTS === '1'
      ? resolve('../docs/design/screenshots/after-wp11')
      : testInfo.outputDir;
  await mkdir(directory, { recursive: true });
  const fileName = `${testInfo.title.replaceAll(' ', '-')}-${name}`;
  await page.screenshot({ path: resolve(directory, `${fileName}.png`) });
  if (
    await page.evaluate(
      () => document.documentElement.scrollHeight > innerHeight,
    )
  ) {
    await page.screenshot({
      path: resolve(directory, `${fileName}-full.png`),
      fullPage: true,
    });
  }
  expect(
    await page.locator('main .ds-button--primary:visible').count(),
    `${name}: one primary action`,
  ).toBeLessThanOrEqual(1);
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
      await page.addInitScript((t) => {
        try {
          localStorage.setItem('rehab-hub.theme', t);
        } catch {
          /* storage unavailable */
        }
      }, theme);
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
        ['/history?tab=sessions', 'history-sessions'],
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
      await expect(page.getByRole('meter')).toHaveCount(5);
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
      await page.goto('/evaluate');
      const measureFriction = page.getByRole('button', {
        name: 'Measure glove friction',
        exact: true,
      });
      if (await measureFriction.count()) {
        await page
          .getByRole('checkbox', {
            name: 'The glove is empty and hanging freely',
          })
          .check();
        await measureFriction.click();
        await expect(
          page.getByText(
            'Recent glove friction saved. Put the glove on, then relax.',
          ),
        ).toBeVisible({ timeout: 60_000 });
      }

      await page
        .getByRole('checkbox', { name: 'Hand relaxed in the glove' })
        .check();
      await page
        .getByRole('button', { name: 'Start evaluation', exact: true })
        .click();
      await expect(page.locator('.focus')).toBeVisible();
      await inspect(page, 'evaluation-live', testInfo);
      await expect(
        page.getByRole('heading', { name: 'Your evaluation', exact: true }),
      ).toBeVisible({ timeout: 45_000 });
      await inspect(page, 'evaluation-results', testInfo);
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
