import { expect, type Page } from '@playwright/test';
import type { Calibration } from '../src/contracts/calibration';

export async function calibrateSimulator(page: Page) {
  await page.goto('/calibrate');
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/api/calibrations'),
  );
  await page
    .getByRole('button', { name: 'Calibrate simulator', exact: true })
    .click();
  const calibration = (await (await saved).json()) as Calibration;
  await page.route('**/api/calibrations/latest', (route) =>
    route.fulfill({ json: calibration }),
  );
  await expect(
    page.getByText('Simulator calibrated.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Continue to practice' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your practice', exact: true }),
  ).toBeVisible();
  return calibration;
}
export async function silenceCoach(page: Page) {
  // Speech is observed synchronously while the coach is Off; the local safety net stays armed.
  await page.addInitScript(() => {
    const spoken: string[] = [];
    Object.defineProperty(window, '__spoken', { value: spoken });
    window.speechSynthesis.speak = (utterance) => {
      spoken.push(utterance.text);
      queueMicrotask(() =>
        utterance.onend?.(new SpeechSynthesisEvent('end', { utterance })),
      );
    };
  });
}
/**
 * The glove moves only when the patient asks. In UI specs the simulated patient presses
 * "Help me open" whenever the app offers help, like a real patient would.
 */
export async function askForHelpWhenOffered(page: Page) {
  await page.addInitScript(() => {
    setInterval(() => {
      if (
        !document.body?.textContent?.includes(
          'Want the glove to help you open?',
        )
      )
        return;
      const button = [...document.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Help me open' && !b.disabled,
      );
      button?.click();
    }, 100);
  });
}
