import { test, expect } from '@playwright/test';
import { calibrateSimulator } from './helpers';

test('all five manual servo ranges must be set and acknowledged', async ({
  page,
}) => {
  await calibrateSimulator(page);
  await page.goto('/calibrate');
  const fingers = page.getByRole('group', { name: 'Finger to calibrate' });
  await expect(fingers.getByRole('button')).toHaveCount(5);
  const send = page.getByRole('button', {
    name: 'Send glove ranges',
    exact: true,
  });
  await expect(send).toBeDisabled();
  for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
    await fingers
      .getByRole('button', { name: new RegExp(`^${finger} ·`) })
      .click();
    await page.getByRole('button', { name: 'Set open', exact: true }).click();
    for (let step = 0; step < 4; step++)
      await page.getByRole('button', { name: '+5°', exact: true }).click();
    await page.getByRole('button', { name: 'Set closed', exact: true }).click();
    if (finger !== 'Pinky') await expect(send).toBeDisabled();
  }
  await expect(send).toBeEnabled();
  await expect(fingers.getByRole('button', { name: / · Set$/ })).toHaveCount(5);
  await send.click();
  await expect(
    page.getByRole('heading', { name: 'Step 2 · Camera range', exact: true }),
  ).toBeVisible();
});

test('Setup clearly rejects a serial board reporting three fingers', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let receiver: ReadableStreamDefaultController<Uint8Array>;
    const port = {
      readable: new ReadableStream<Uint8Array>({
        start(controller) {
          receiver = controller;
        },
      }),
      writable: new WritableStream<Uint8Array>({
        write(bytes) {
          for (const line of new TextDecoder()
            .decode(bytes)
            .split('\n')
            .filter(Boolean)) {
            const command = JSON.parse(line) as { t: string };
            if (command.t === 'hello')
              receiver.enqueue(
                new TextEncoder().encode(
                  JSON.stringify({
                    t: 'info',
                    fw: 'old-three-finger-board',
                    fingers: 3,
                    limit: 900,
                    calib: [null, null, null],
                  }) + '\n',
                ),
              );
          }
        },
      }),
      open: async () => {},
      close: async () => {},
    };
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        getPorts: async () => [port],
        requestPort: async () => port,
        addEventListener() {},
        removeEventListener() {},
      },
    });
  });
  await page.goto('/setup');
  await page
    .getByRole('button', { name: /^(Connect|Reconnect) glove$/ })
    .click();
  await expect(
    page.getByRole('alert').filter({ hasText: /3 fingers/ }),
  ).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: /5/ })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Glove not connected' }),
  ).toBeVisible();
});
