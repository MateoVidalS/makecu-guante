import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { BROWNOUT_MESSAGE } from '../src/runtime/boardRestart';

const boot = readFileSync(
  new URL('../../contracts/fixtures/serial_boot_brownout.txt', import.meta.url),
  'utf8',
);

test('serial brown-out cause reaches Setup and runtime status and clears on normal reboot', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route('**/api/calibrations/latest', (route) =>
    route.fulfill({ json: null }),
  );
  await page.addInitScript((bootLine) => {
    let receiver: ReadableStreamDefaultController<Uint8Array>;
    const send = (line: string) =>
      receiver.enqueue(new TextEncoder().encode(line + '\n'));
    Object.defineProperty(window, '__emitBoardBoot', {
      value: (reset_reason: number) =>
        send(JSON.stringify({ t: 'evt', e: 'boot', reset_reason })),
    });
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
            if ((JSON.parse(line) as { t: string }).t === 'hello') {
              send(bootLine.trim());
              send(
                JSON.stringify({
                  t: 'info',
                  fw: 'test-five-finger',
                  fingers: 5,
                  limit: 1500,
                  calib: [null, null, null, null, null],
                }),
              );
            }
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
  }, boot);
  await page.goto('/setup');
  await page
    .getByRole('button', { name: /^(Connect|Reconnect) glove$/ })
    .click();
  await expect(
    page.locator('main').getByText(BROWNOUT_MESSAGE, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('alert', { name: 'Glove board status' }),
  ).toContainText(BROWNOUT_MESSAGE);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() =>
    (
      window as unknown as { __emitBoardBoot(reason: number): void }
    ).__emitBoardBoot(1),
  );
  await expect(page.getByText(BROWNOUT_MESSAGE, { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('heading', { name: 'Glove ready', exact: true }),
  ).toBeVisible();
});
