import { test, expect } from '@playwright/test';

test('no-port fallback simulates only the glove and retains the camera stream', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        getPorts: async () => [],
        requestPort: async () => {
          throw new DOMException('No port selected', 'NotFoundError');
        },
        addEventListener() {},
        removeEventListener() {},
      },
    });
  });
  await page.goto('/setup');
  // Playwright supplies a fake video device; this exercises the real camera
  // source/model plumbing without requesting any physical camera or USB port.
  const stopCamera = page.getByRole('button', {
    name: 'Stop camera',
    exact: true,
  });
  if (await stopCamera.isVisible()) await stopCamera.click();
  await page
    .getByRole('button', { name: 'Connect camera', exact: true })
    .click();
  const preview = page.getByRole('figure', { name: 'Hand camera preview' });
  await expect(preview.locator('video')).toHaveCount(1, { timeout: 30_000 });
  await expect(stopCamera).toBeVisible();
  // The preview shows the stream right away; the camera action finishes once the hand model
  // has loaded (slow on CPU), and Setup keeps its buttons disabled until then.
  const connectGlove = page.getByRole('button', {
    name: /^(Connect|Reconnect) glove$/,
  });
  await expect(connectGlove).toBeEnabled({ timeout: 90_000 });
  await connectGlove.click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'No glove was selected.' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Simulate glove', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Glove ready', exact: true }),
  ).toBeVisible();
  await expect(preview.locator('video')).toHaveCount(1);
  await expect(
    preview.getByText('Simulated camera', { exact: true }),
  ).toHaveCount(0);
  await expect(stopCamera).toBeVisible();
});
