import { expect, type Page } from '@playwright/test';

export async function calibrateSimulator(page: Page) {
  await page.goto('/calibrate');
  await page
    .getByRole('button', { name: 'Calibrate simulator', exact: true })
    .click();
  await expect(
    page.getByText('Simulator calibrated.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Continue to practice' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your practice', exact: true }),
  ).toBeVisible();
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
