import { expect, test, type Page } from '@playwright/test';

/**
 * Setup must never get stuck on "Connecting glove…": every USB failure mode leaves
 * Simulate glove usable, and simulating only replaces the glove (camera untouched).
 */
type Mode = 'cancel' | 'hang' | 'stale' | 'noinfo';

async function withSerial(page: Page, mode: Mode) {
  await page.addInitScript((m: Mode) => {
    const never = () => new Promise<never>(() => {});
    const port = {
      open: m === 'stale' ? never : async () => {},
      close: async () => {},
      readable: m === 'noinfo' ? new ReadableStream({ start() {} }) : null,
      writable: m === 'noinfo' ? new WritableStream({ write() {} }) : null,
      getInfo: () => ({}),
      addEventListener() {},
      removeEventListener() {},
    };
    const serial = {
      getPorts: async () => (m === 'stale' || m === 'noinfo' ? [port] : []),
      requestPort:
        m === 'hang'
          ? never
          : async () => {
              throw new DOMException(
                "Failed to execute 'requestPort' on 'Serial': No port selected by the user.",
                'NotFoundError',
              );
            },
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(navigator, 'serial', {
      value: serial,
      configurable: true,
    });
  }, mode);
  await page.goto('/setup');
}

const gloveHeading = (page: Page) =>
  page.getByLabel('Glove connection').getByRole('heading');
const connect = (page: Page) =>
  page.getByRole('button', { name: /Connect glove|Reconnect glove/ }).click();
const simulate = (page: Page) =>
  page.getByRole('button', { name: 'Simulate glove' }).click();

async function expectSimulatedReady(page: Page) {
  await expect(gloveHeading(page)).toHaveText(/Glove ready/, {
    timeout: 5_000,
  });
  await expect(page.getByText(/Simulated glove.*No motors move/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Simulate glove' }),
  ).toHaveCount(0);
}

test('cancelled port chooser explains and Simulate glove recovers', async ({
  page,
}) => {
  await withSerial(page, 'cancel');
  await connect(page);
  await expect(page.getByRole('alert')).toContainText('No glove was selected');
  await expect(gloveHeading(page)).toHaveText(/Glove not connected/);
  await simulate(page);
  await expectSimulatedReady(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a chooser that never answers can be simulated over or cancelled', async ({
  page,
}) => {
  await withSerial(page, 'hang');
  await connect(page);
  await expect(gloveHeading(page)).toHaveText(/Connecting glove/);
  await expect(
    page.getByRole('button', { name: 'Simulate glove' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(gloveHeading(page)).toHaveText(/Glove not connected/);
  await connect(page);
  await simulate(page);
  await expectSimulatedReady(page);
});

test('a stale granted port times out with a clear message', async ({
  page,
}) => {
  await withSerial(page, 'stale');
  await connect(page);
  await expect(page.getByRole('alert')).toContainText(
    'The glove port did not open',
    {
      timeout: 8_000,
    },
  );
  await simulate(page);
  await expectSimulatedReady(page);
});

test('a USB device without the glove firmware is explained', async ({
  page,
}) => {
  await withSerial(page, 'noinfo');
  await connect(page);
  await expect(page.getByRole('alert')).toContainText(
    'not as the Rehab glove',
    {
      timeout: 6_000,
    },
  );
  await simulate(page);
  await expectSimulatedReady(page);
});

test('simulate and real connect can alternate without getting stuck', async ({
  page,
}) => {
  await withSerial(page, 'cancel');
  for (let i = 0; i < 2; i++) {
    await connect(page);
    await expect(gloveHeading(page)).toHaveText(/Glove not connected/);
    await simulate(page);
    await expectSimulatedReady(page);
  }
});
