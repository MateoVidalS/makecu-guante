import { test, expect } from '@playwright/test';
import { calibrateSimulator, silenceCoach } from './helpers';

test('focus-shell recovery readies each simulator and simple voice within five seconds without reload', async ({
  page,
}, testInfo) => {
  await silenceCoach(page);
  await calibrateSimulator(page);
  const errors: string[] = [];
  const timings: Record<string, number> = {};
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluate(() => {
    Object.defineProperty(window, '__recoveryPage', { value: 'same-document' });
  });
  for (const source of ['glove', 'camera']) {
    await page
      .getByRole('button', { name: 'Start practice', exact: true })
      .click();
    await expect(page.locator('.focus')).toBeVisible();
    await page.locator('.runtime-fallback').evaluate((menu) => {
      // Expose simulator fault injection only inside this test.
      (menu as HTMLElement).hidden = false;
      menu.querySelector('summary')!.click();
    });
    const started = Date.now();
    await page
      .getByRole('button', { name: `Restart simulated ${source}`, exact: true })
      .click();
    await expect(
      page.getByText(
        'Simulator ready. Start a new practice when you are ready.',
        { exact: true },
      ),
    ).toBeVisible();
    timings[source] = Date.now() - started;
    expect(timings[source]).toBeLessThan(5000);
    await expect(
      page.getByRole('heading', { name: 'Session complete', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('status', { name: 'Session saving status' }),
    ).toHaveText('Saved');
    expect(
      await page.evaluate(
        () => (window as unknown as { __recoveryPage: string }).__recoveryPage,
      ),
    ).toBe('same-document');
    await page.locator('.runtime-fallback').evaluate((menu) => {
      // Expose simulator fault injection only inside this test.
      (menu as HTMLElement).hidden = false;
      menu.querySelector('summary')!.click();
    });
    await page
      .getByRole('button', { name: 'Practice again', exact: true })
      .click();
  }
  await page
    .getByRole('button', { name: 'Start practice', exact: true })
    .click();
  await page.getByText('Coach controls', { exact: true }).click();
  await page.getByLabel('Voice mode').selectOption('off');
  await page.getByText('Coach controls', { exact: true }).click();
  await page.locator('.runtime-fallback').evaluate((menu) => {
    // Expose simulator fault injection only inside this test.
    (menu as HTMLElement).hidden = false;
    menu.querySelector('summary')!.click();
  });
  const started = Date.now();
  await page
    .getByRole('button', { name: 'Use simple voice', exact: true })
    .click();
  await expect(
    page.getByText('Simple voice ready.', { exact: true }),
  ).toBeVisible();
  timings.voice = Date.now() - started;
  expect(timings.voice).toBeLessThan(5000);
  await expect(page.locator('.focus')).toBeVisible();
  await expect(
    page.locator('.coach-compact').getByRole('switch', { name: 'Microphone' }),
  ).toHaveCount(1);
  await testInfo.attach('recovery-wall-time-ms.json', {
    body: JSON.stringify(timings),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

test('simulated STOP, disconnect and camera loss announce, focus and recover safely', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await silenceCoach(page);
  await calibrateSimulator(page);
  await page
    .getByRole('button', { name: 'Start practice', exact: true })
    .click();
  const safety = page.locator('#safety-banner-slot [role=alert]');
  await page.locator('.runtime-fallback').evaluate((menu) => {
    // Expose simulator fault injection only inside this test.
    (menu as HTMLElement).hidden = false;
    menu.querySelector('summary')!.click();
  });
  await page
    .getByRole('button', { name: 'Press simulated STOP', exact: true })
    .click();
  await expect(safety).toBeVisible();
  await expect(
    safety.getByRole('button', { name: 'Resume', exact: true }),
  ).toBeFocused();
  await page.locator('.runtime-fallback').evaluate((menu) => {
    // Expose simulator fault injection only inside this test.
    (menu as HTMLElement).hidden = false;
    menu.querySelector('summary')!.click();
  });
  await page
    .getByRole('button', { name: 'Release simulated STOP', exact: true })
    .click();
  await page.locator('.runtime-fallback').evaluate((menu) => {
    // Expose simulator fault injection only inside this test.
    (menu as HTMLElement).hidden = false;
    menu.querySelector('summary')!.click();
  });
  await safety.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(safety).not.toBeVisible();
  await page.locator('.runtime-fallback').evaluate((menu) => {
    // Expose simulator fault injection only inside this test.
    (menu as HTMLElement).hidden = false;
    menu.querySelector('summary')!.click();
  });
  await page
    .getByRole('button', { name: 'Unplug simulated glove', exact: true })
    .click();
  await expect(safety).toBeVisible();
  await expect(
    safety.getByRole('button', { name: 'Resume', exact: true }),
  ).toBeFocused();
  await page.locator('.runtime-fallback').evaluate((menu) => {
    // Expose simulator fault injection only inside this test.
    (menu as HTMLElement).hidden = false;
    menu.querySelector('summary')!.click();
  });
  await page
    .getByRole('button', { name: 'Use simulated glove', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Session complete', exact: true }),
  ).toBeVisible();
  await page.locator('.runtime-fallback').evaluate((menu) => {
    // Expose simulator fault injection only inside this test.
    (menu as HTMLElement).hidden = false;
    menu.querySelector('summary')!.click();
  });
  await page
    .getByRole('button', { name: 'Practice again', exact: true })
    .click();
  // A single closing pose reaches assistance promptly, where camera loss must release.
  await page
    .getByRole('button', { name: 'Fist only, 1 rep', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Start practice', exact: true })
    .click();
  await expect(
    page
      .locator('.phase-ring')
      .getByText('The glove is helping', { exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  await page.locator('.runtime-fallback').evaluate((menu) => {
    // Expose simulator fault injection only inside this test.
    (menu as HTMLElement).hidden = false;
    menu.querySelector('summary')!.click();
  });
  await page
    .getByRole('button', {
      name: 'Hide simulated hand for 3 seconds',
      exact: true,
    })
    .click();
  await expect(safety).toBeVisible();
  await expect(
    safety.getByRole('button', { name: 'Resume', exact: true }),
  ).toBeFocused();
  const spoken = await page.evaluate(
    () => (window as unknown as { __spoken: string[] }).__spoken,
  );
  expect(spoken).toContain("I can't see your hand. Pausing.");
  expect(spoken).toContain('The glove disconnected. It has released.');
  await safety.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(safety).not.toBeVisible();
});
