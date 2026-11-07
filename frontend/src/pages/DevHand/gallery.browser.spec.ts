import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const evidence = fileURLToPath(
  new URL('../../../../docs/design/screenshots/ux-u2/', import.meta.url),
);

test('compares every pose in all four states, in color and grayscale', async ({
  page,
}) => {
  await mkdir(evidence, { recursive: true });
  await page.goto('/_dev/hand');
  await page
    .getByRole('checkbox', { name: 'Compare states', exact: true })
    .check();
  await page
    .getByRole('checkbox', { name: 'Reduced motion', exact: true })
    .check();
  for (const [width, height] of [
    [1280, 720],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height });
    for (const [id, name] of [
      ['open', 'Open hand'],
      ['hook', 'Hook'],
      ['tabletop', 'Tabletop'],
      ['straight_fist', 'Straight fist'],
      ['full_fist', 'Full fist'],
      ['pinch', 'Pinch'],
    ]) {
      await page.getByRole('button', { name, exact: true }).click();
      const comparison = page.getByRole('group', {
        name: `${name} state comparison`,
        exact: true,
      });
      await expect(comparison.getByRole('img')).toHaveCount(4);
      await comparison.scrollIntoViewIfNeeded();
      for (const grayscale of [false, true]) {
        await page
          .getByRole('checkbox', { name: 'Grayscale', exact: true })
          .setChecked(grayscale);
        await expect(page.locator('.hand-gallery')).toHaveAttribute(
          'data-grayscale',
          String(grayscale),
        );
        await page.waitForTimeout(150);
        await page.screenshot({
          path: `${evidence}states-${id}-${grayscale ? 'grayscale' : 'color'}-${width}.png`,
        });
      }
    }
  }
});

test('renders all poses, grayscale overlay, mirroring, loss of tracking and dark mode', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/_dev/hand');
  const hand = page.getByRole('img');
  await expect(hand).toHaveAttribute('aria-label', /Target pose: Open hand/);
  await expect(page.locator('canvas')).toBeVisible();
  await mkdir(evidence, { recursive: true });
  for (const [id, name] of [
    ['open', 'Open hand'],
    ['hook', 'Hook'],
    ['tabletop', 'Tabletop'],
    ['straight_fist', 'Straight fist'],
    ['full_fist', 'Full fist'],
    ['pinch', 'Pinch'],
  ]) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('button', { name: 'Match target' }).click();
    await expect(hand).toHaveAttribute('aria-label', new RegExp(name));
    await page.waitForTimeout(500);
    await hand.screenshot({ path: `${evidence}${id}.png` });
  }
  await page.getByRole('button', { name: 'Hook', exact: true }).click();
  await page.getByRole('button', { name: 'Open actual hand' }).click();
  await hand.evaluate((element) => {
    (element as HTMLElement).style.filter = 'grayscale(1)';
  });
  await page.waitForTimeout(500);
  await hand.screenshot({ path: `${evidence}grayscale.png` });
  await hand.evaluate((element) => {
    (element as HTMLElement).style.filter = '';
  });
  await page
    .getByRole('combobox', { name: 'Affected hand' })
    .selectOption('left');
  await page.getByRole('button', { name: 'Match target' }).click();
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
  await page.waitForTimeout(500);
  await hand.screenshot({ path: `${evidence}left-dark.png` });
  await page.getByRole('checkbox', { name: 'Hand visible' }).uncheck();
  await expect(hand).toHaveAttribute('data-visible', 'false');
  await expect(
    page.getByRole('status').filter({ hasText: "I can't see your hand" }),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: 'Hand visible' }).check();
  await expect(hand).toHaveAttribute('data-visible', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page
    .getByRole('combobox', { name: 'Index state' })
    .selectOption('reached');
  await expect(page.getByRole('combobox', { name: 'Index state' })).toHaveValue(
    'reached',
  );
  expect(errors).toEqual([]);
});

test('maintains at least 55 fps with camera capture and a 30 Hz joint source', async ({
  page,
}) => {
  test.skip(
    process.env.WP6_PERFORMANCE !== '1',
    'Opt in on a quiet machine with WP6_PERFORMANCE=1.',
  );
  await page.goto('/_dev/hand');
  await page.getByRole('checkbox', { name: '30 Hz stub vision' }).check();
  await page.getByText('Camera and performance check', { exact: true }).click();
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByRole('button', { name: 'Stop camera' })).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('video')
        .evaluate((video) => (video as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await page.getByRole('img').scrollIntoViewIfNeeded();
  // Fixed warm-up excludes shader compilation and initial camera startup.
  await page.waitForTimeout(10_000);
  const startFrames = Number(
    await page.getByLabel('Stub frames').textContent(),
  );
  const samples: number[] = [];
  const start = Date.now();
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(1000);
    samples.push(Number(await page.getByTestId('hand-fps').textContent()));
  }
  const seconds = (Date.now() - start) / 1000;
  const stubHz =
    (Number(await page.getByLabel('Stub frames').textContent()) - startFrames) /
    seconds;
  const renderer = await page.locator('canvas').evaluate((canvas) => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2')!;
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return extension
      ? (gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) as string)
      : 'Unavailable';
  });
  const camera = await page.locator('video').evaluate((video) => {
    const track = (
      (video as HTMLVideoElement).srcObject as MediaStream
    ).getVideoTracks()[0];
    const { width, height, frameRate } = track.getSettings();
    return {
      label: track.label,
      width,
      height,
      frameRate,
      state: track.readyState,
      decodedFrames: (video as HTMLVideoElement).getVideoPlaybackQuality()
        .totalVideoFrames,
    };
  });
  const average = samples.reduce((a, b) => a + b, 0) / samples.length;
  const report = {
    date: new Date().toISOString(),
    viewport: page.viewportSize(),
    renderer,
    camera,
    warmupSeconds: 10,
    samples,
    average,
    stubHz,
    note: 'Chromium synthetic camera capture; no MediaPipe inference. Hardware camera check remains an integration check.',
  };
  await mkdir(evidence, { recursive: true });
  await writeFile(
    `${evidence}performance.json`,
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report));
  await page.getByRole('button', { name: 'Stop camera' }).click();
  expect(stubHz).toBeGreaterThanOrEqual(28);
  expect(average).toBeGreaterThanOrEqual(55);
});
