import { expect, test } from '@playwright/test';
import type { TherapySession } from '../../components/therapy/data';
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
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.locator('.mx-attempt')).toBeVisible({ timeout: 30000 });
    await page.getByText('Coach controls', { exact: true }).click();
    await expect(page.getByLabel('Voice mode')).toBeVisible();
    await page.getByText('Coach controls', { exact: true }).click();
    expect(
      await page.evaluate(() => {
        const details = document
          .querySelector('.live-details')!
          .getBoundingClientRect();
        const coach = document
          .querySelector('.coach-quick-controls')!
          .getBoundingClientRect();
        const audit = document
          .querySelector('.therapy-live')!
          .getBoundingClientRect();
        return (
          details.bottom <= audit.top &&
          coach.bottom <= audit.top &&
          document.documentElement.scrollHeight <= innerHeight
        );
      }),
    ).toBe(true);
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
    for (let i = 0; i < 12; i++)
      await page
        .getByRole('button', { name: 'Test coach decision', exact: true })
        .click();
    await page.getByRole('button', { name: 'Timeline', exact: true }).click();
    const brakeBox = await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Brake', exact: true })
      .boundingBox();
    expect(brakeBox!.y + brakeBox!.height).toBeLessThanOrEqual(720);
    const list = page
      .getByRole('dialog')
      .getByRole('list', { name: 'Coach decisions and feelings timeline' });
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
      true,
    );
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Brake', exact: true })
      .click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('saved therapy records appear on attempt phases, the session timeline and doctor trends', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/history?tab=sessions');
  await expect(page.locator('a[href="/history/sessions/8"]')).toBeVisible();
  await page.evaluate(async () => {
    const modulePath = '/src/mocks/handlers.ts';
    const { mockState } = await import(modulePath);
    for (const session of Object.values(
      mockState.details,
    ) as TherapySession[]) {
      const start = Date.parse(session.started_at);
      const t = (seconds: number) =>
        new Date(start + seconds * 1000).toISOString();
      session.coach_decisions = [
        {
          id: `rest-${session.id}`,
          t: t(1),
          session_id: session.id,
          tool: 'add_rest',
          requested: { seconds: 30 },
          applied: { seconds: 20 },
          result: 'clamped',
          reason: 'Time for a comfortable rest.',
          source: 'coach',
        },
      ];
      session.feelings =
        session.id === 4
          ? []
          : [
              {
                t: t(2),
                session_id: session.id,
                attempt_index: 0,
                pain: session.id % 5,
                fatigue: 6,
                note: '',
                source: 'ui',
              },
            ];
    }
  });
  await page.locator('a[href="/history/sessions/8"]').click();
  await expect(
    page.getByRole('img', {
      name: /Attempt phases:.*Coach timeline:.*Rest added/,
    }),
  ).toBeVisible();
  const timeline = page.getByRole('list', {
    name: 'Coach decisions and feelings timeline',
  });
  await expect(timeline).toContainText('0:01');
  await expect(timeline).toContainText('Rest added · clamped');
  await expect(timeline).toContainText('Pain 3/10 · Fatigue 6/10');
  await timeline.getByText('Decision details').click();
  await expect(timeline).toContainText('"seconds": 30');
  await expect(timeline).toContainText('"seconds": 20');
  await page.screenshot({
    path: info.outputPath('replay-therapy.png'),
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Doctor view', exact: true }).click();
  const review = page.getByRole('region', {
    name: 'Reported feelings and coach decisions',
  });
  await expect(
    review.getByRole('img', { name: /Reported pain and fatigue/ }),
  ).toBeVisible();
  await expect(review.locator('.recharts-line-curve')).toHaveCount(2);
  await expect(review.locator('.therapy-feeling-dot')).toHaveCount(14);
  await review.getByText('Show feelings as table').click();
  await expect(review.getByRole('table')).toContainText('Demo data');
  await expect(review.getByRole('table')).toContainText('—');
  await expect(review.getByText('Rest added · clamped: 8')).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    await page.screenshot({
      fullPage: true,
      path: info.outputPath(`doctor-therapy-${theme}.png`),
    });
  }
  const axe = await new AxeBuilder({ page })
    .include('.therapy-trend')
    .analyze();
  expect(
    axe.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? ''),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});
