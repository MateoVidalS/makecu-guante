import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const routes = [
  '/history',
  '/history?tab=sessions',
  '/history/sessions/8',
  '/history/evaluations/3',
  '/doctor',
  '/evaluate',
];
test('all data views render without console errors across patient sizes and themes', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.addInitScript(() =>
    localStorage.setItem('rehab-hub.theme', 'system'),
  );
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
    for (const colorScheme of ['light'] as const) {
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
          path:
            process.env.REHAB_SIMPLIFY_SCREENSHOTS === '1'
              ? resolve(
                  '../docs/design/screenshots/simplify',
                  `${route.replace(/[^a-z0-9]/gi, '-')}-${colorScheme}-${viewport.width}.png`,
                )
              : info.outputPath(
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
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /Export/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Doctor view', exact: true }).click();
  await expect(page.getByText('Details', { exact: true })).toBeVisible();
  await page.getByText('Details', { exact: true }).click();
  await page.getByLabel('Pose').selectOption('full_fist');
  const chart = page.getByRole('article', { name: /^Thumb:/ }).first();
  await chart.getByText('Show as table', { exact: true }).click();
  const table = chart.getByRole('table');
  await expect(table).toContainText('35%');
  await expect(table).toContainText('63%');
  await expect(table).toContainText('Demo data');
  await expect(page.locator('.recharts-line-curve')).toHaveCount(5);
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
  await expect(page.locator('.report-details')).not.toHaveAttribute('open');
  await page.getByText('Details', { exact: true }).click();
  await expect(page.locator('.recharts-line-curve')).toHaveCount(5);
  await expect(page.locator('.report-glance .viz-card')).toHaveCount(4);
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
          return rect.width > 280 && rect.width < 360 && rect.height > 100;
        }),
      ),
    ).toBe(true);
    await page.pdf({ path, format, printBackground: true });
    const pdf = await readFile(path);
    expect(
      (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length,
    ).toBeGreaterThanOrEqual(4);
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

test('mixed three/five-finger history keeps missing measurements visible', async ({
  page,
}, info) => {
  await page.goto('/profile');
  await expect(page.getByLabel('Pseudonym')).toBeVisible();
  await page.evaluate(async () => {
    const modulePath = '/src/mocks/handlers.ts';
    const { mockState } = await import(/* @vite-ignore */ modulePath);
    const legacy = (finger: string) => finger !== 'ring' && finger !== 'pinky';
    // Keep later sessions at five fingers, and remove only historical measurements.
    for (const session of mockState.sessions) {
      if (session.id <= 2) {
        session.summary.per_finger = session.summary.per_finger.filter(
          (f: { finger: string }) => legacy(f.finger),
        );
      }
    }
    const attempt = mockState.details[1].attempts[0];
    attempt.fingers = attempt.fingers.filter((f: { finger: string }) =>
      legacy(f.finger),
    );
    const trace = mockState.traces[attempt.id];
    for (const finger of ['ring', 'pinky']) {
      trace.closure[finger] = trace.t.map(() => null);
      trace.servo[finger] = [];
    }
  });
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await expect(
    page.getByRole('img', { name: /Hand map, first session/ }),
  ).toHaveAccessibleName(
    /Ring Not measured then, 67% now.*Pinky Not measured then, 67% now/,
  );
  const screenshot = async (name: string) =>
    page.screenshot({
      path:
        process.env.REHAB_SIMPLIFY_SCREENSHOTS === '1'
          ? resolve('../docs/design/screenshots/simplify', `${name}.png`)
          : info.outputPath(`${name}.png`),
      fullPage: true,
    });
  await screenshot('mixed-history-light-1280');
  await page.getByRole('link', { name: 'Doctor view', exact: true }).click();
  await page.getByText('Details', { exact: true }).click();
  const ring = page.getByRole('article', { name: /^Ring:/ }).last();
  await ring.getByText('Show as table', { exact: true }).click();
  await expect(ring.getByRole('table')).toContainText('Not measured');
  await expect(ring.getByRole('table')).toContainText('67%');
  await page
    .getByRole('link', { name: 'Exit doctor view', exact: true })
    .click();
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await page.getByRole('tab', { name: 'Sessions', exact: true }).click();
  await page.getByRole('link', { name: 'Oct 15, 2026', exact: true }).click();
  const table = page.getByRole('table', {
    name: 'Per-finger estimates from the camera',
  });
  await expect(table.getByRole('row', { name: /Ring/ })).toContainText(
    'Not measured',
  );
  await expect(table.getByRole('row', { name: /Pinky/ })).toContainText(
    'Not measured',
  );
  await expect(page.getByText('Loading chart…')).toHaveCount(0);
  await screenshot('legacy-replay-light-1280');
});

test('evaluation measures all friction before a selected patient subset and reuses the saved baseline', async ({
  page,
}, info) => {
  test.setTimeout(150_000);
  await page.goto('/evaluate');
  const measure = page.getByRole('button', {
    name: 'Measure glove friction',
    exact: true,
  });
  const start = page.getByRole('button', {
    name: 'Start evaluation',
    exact: true,
  });
  await expect(measure).toBeDisabled();
  await expect(start).toBeDisabled();
  for (const name of ['Thumb', 'Index', 'Middle'])
    await page.getByRole('checkbox', { name, exact: true }).uncheck();
  await page
    .getByRole('checkbox', { name: 'The glove is empty and hanging freely' })
    .check();
  await measure.click();
  await expect(
    page.getByRole('heading', { name: /Measuring empty-glove friction/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Evaluation steps' }).locator('li'),
  ).toHaveCount(10);
  await expect(
    page.getByRole('button', { name: 'Stop evaluation', exact: true }),
  ).toHaveCount(1);
  await expect(page.locator('.app-progress')).not.toContainText('Pose');
  await page.screenshot({
    path:
      process.env.REHAB_SIMPLIFY_SCREENSHOTS === '1'
        ? resolve(
            '../docs/design/screenshots/simplify/evaluate-friction-light-1280.png',
          )
        : info.outputPath('evaluate-friction.png'),
  });
  await expect(
    page.getByText(
      'Recent glove friction saved. Put the glove on, then relax.',
    ),
  ).toBeVisible({ timeout: 70_000 });
  await expect(start).toBeDisabled();
  await page
    .getByRole('checkbox', { name: 'Hand relaxed in the glove' })
    .check();
  await start.click();
  await expect(
    page.getByRole('heading', { name: 'Measuring ring', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Evaluation steps' }).locator('li'),
  ).toHaveCount(4);
  await expect(
    page.getByRole('button', { name: 'Stop evaluation', exact: true }),
  ).toHaveCount(1);
  await page
    .getByRole('button', { name: 'Stop evaluation', exact: true })
    .click();
  await expect(
    page.getByText('Evaluation stopped. Rest before trying again.'),
  ).toBeVisible();
  await expect(measure).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText(
      'Recent glove friction saved. Put the glove on, then relax.',
    ),
  ).toBeVisible();
  await expect(measure).toHaveCount(0);
});
