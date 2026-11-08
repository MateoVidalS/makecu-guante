import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { ExercisePhase, EngineEvent } from '../../contracts/engine';

declare global {
  interface Window {
    u4Layout: {
      phase(phase: ExercisePhase): void;
      opening(): void;
      evaluationResult(): void;
      progress(index: number, rep: number): void;
      safety(source: Extract<EngineEvent, { kind: 'safety' }>['source']): void;
    };
  }
}
const shots = resolve('src/pages/Exercise/evidence/o6');
async function frame(page: Page, state: string, width: number) {
  await expect(page.locator('.hand-view canvas')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThanOrEqual((await page.viewportSize())!.height);
  const boxes = await page
    .locator(
      '.hand-view canvas, .instruction, .phase-ring, .mx-gauge__track, .practice-actions .ds-button',
    )
    .evaluateAll((elements) =>
      elements.map((el) => el.getBoundingClientRect().toJSON()),
    );
  expect(boxes).toHaveLength(11);
  for (const box of boxes) {
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(
      (await page.viewportSize())!.height,
    );
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.height).toBeGreaterThan(0);
  }
  await expect(page.locator('.mx-gauge__track')).toHaveCount(5);
  if (width === 1440)
    expect(
      (await page.locator('.hand-view canvas').boundingBox())!.width,
    ).toBeGreaterThanOrEqual(width * 0.55);
  await page.screenshot({
    path: `${state === 'assisted-open' ? shots : '/tmp/rehab-o6-layout'}/after-${state}-${width}.png`,
  });
}
for (const [width, height] of [
  [1280, 720],
  [1440, 900],
]) {
  test(`every phase and safety banner stays in the viewport at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => {
      localStorage.clear();
      window.speechSynthesis.speak = (utterance) =>
        queueMicrotask(() =>
          utterance.onend?.(new SpeechSynthesisEvent('end', { utterance })),
        );
    });
    await page.goto('/src/pages/Exercise/live-harness.html');
    await expect(page.locator('.exercise-live')).toBeVisible();
    for (const phase of [
      'PRESENT',
      'ATTEMPT',
      'ASSIST',
      'HOLD',
      'ASSIST_HOLD',
      'RELEASE',
      'REST',
      'PAUSED',
    ] as const) {
      await page.evaluate((phase) => window.u4Layout.phase(phase), phase);
      await expect(page.locator('.exercise-live')).toHaveAttribute(
        'data-phase',
        phase,
      );
      await frame(page, phase.toLowerCase(), width);
    }
    for (const [index, rep, label] of [
      [0, 1, 'Pose 1 of 5 · Rep 1 of 3'],
      [2, 3, 'Pose 1 of 5 · Rep 3 of 3'],
      [3, 1, 'Pose 2 of 5 · Rep 1 of 3'],
      [14, 3, 'Pose 5 of 5 · Rep 3 of 3'],
    ] as const) {
      await page.evaluate(
        ([index, rep]) => window.u4Layout.progress(index, rep),
        [index, rep],
      );
      await expect(page.locator('.app-progress')).toHaveText(label);
    }
    for (const source of [
      'overcurrent',
      'stop_button',
      'glove_disconnected',
      'camera_lost',
    ] as const) {
      // Reset through REST, exactly as the banner's runtime subscription expects.
      await page.evaluate(() => window.u4Layout.phase('REST'));
      await page.getByText('Coach controls', { exact: true }).click();
      await expect(page.getByLabel('Voice mode')).toBeVisible();
      await page.evaluate((source) => window.u4Layout.safety(source), source);
      const safety = page.locator('#safety-banner-slot [role=alert]');
      await expect(
        safety.getByRole('button', { name: 'Resume', exact: true }),
      ).toBeFocused();
      await expect(page.getByLabel('Voice mode')).not.toBeVisible();
      await expect(
        page
          .locator('.practice-actions')
          .getByRole('button', { name: 'Resume', exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole('button', { name: 'Skip pose', exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole('button', { name: 'Brake', exact: true }),
      ).toBeEnabled();
      await frame(page, source, width);
      await safety.getByText('What happened?', { exact: true }).click();
      await frame(page, `${source}-details`, width);
    }
    await expect(
      page.getByText('Demo tools', { exact: true }),
    ).not.toBeVisible();
    await expect(page.getByText('Saved', { exact: true })).toHaveCount(0);
    await page.evaluate(() => window.u4Layout.phase('REST'));
    if (width === 1440) {
      await page
        .getByRole('switch', { name: 'Show camera', exact: true })
        .click();
      await frame(page, 'camera-docked', width);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(
      await page
        .locator('.coach-speaking i')
        .first()
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe('none');
    const axe = await new AxeBuilder({ page }).analyze();
    expect(
      axe.violations.filter((v) =>
        ['serious', 'critical'].includes(v.impact ?? ''),
      ),
    ).toEqual([]);
  });
}

for (const [width, height] of [
  [1280, 720],
  [1440, 900],
]) {
  test(`opening assistance and evaluation copy at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/src/pages/Exercise/live-harness.html');
    await page.waitForFunction(
      () => typeof window.u4Layout?.opening === 'function',
    );
    await page.evaluate(() => window.u4Layout.opening());
    await expect(
      page.getByText('The glove is helping you open', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Glove opening help' }),
    ).toBeVisible();
    await expect(
      page.locator('.glove-motor[data-state="pulling"]'),
    ).toHaveCount(5);
    await expect(
      page.getByRole('meter', { name: 'Index', exact: true }),
    ).toHaveAttribute('aria-valuenow', '0.4');
    await expect(
      page.locator('[aria-label="Index opening help"]'),
    ).toHaveAttribute('aria-valuenow', '60');
    await frame(page, 'assisted-open', width);
    await page.goto('/src/pages/Exercise/live-harness.html?view=evaluation');
    await page.waitForFunction(
      () => typeof window.u4Layout?.evaluationResult === 'function',
    );
    await page.evaluate(() => window.u4Layout.evaluationResult());
    await expect(
      page.getByRole('heading', {
        name: 'Resistance to opening (flexor tone)',
      }),
    ).toBeVisible();
    await expect(
      page.getByText(/Fast − slow estimates velocity dependence/),
    ).toBeVisible();
    await page.screenshot({
      path: `${shots}/evaluation-result-${width}.png`,
      fullPage: true,
    });
  });
}
