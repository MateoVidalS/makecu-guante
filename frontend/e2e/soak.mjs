/* global process, window, setTimeout, console, URL */
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const durationMs = Number(process.env.REHAB_SOAK_MS ?? 1_200_000);
const baseURL = process.env.REHAB_SOAK_URL ?? 'http://127.0.0.1:5278';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const samples = [];
try {
  await page.goto(`${baseURL}/e2e/soak.html`);
  await page.waitForFunction(() => !!window.soak);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const initial = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  const start = Date.now();
  void page
    .evaluate(() => window.soak.start())
    .catch((error) => errors.push(error.message));
  while (Date.now() - start < durationMs) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(30_000, durationMs - (Date.now() - start))),
    );
    await cdp.send('HeapProfiler.collectGarbage');
    const usedBytes = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    const state = await page.evaluate(() => window.soak.snapshot());
    const sample = {
      elapsedMs: Date.now() - start,
      usedBytes,
      growthBytes: usedBytes - initial,
      state,
    };
    samples.push(sample);
    console.log(JSON.stringify(sample));
  }
  const final = await page.evaluate(() => window.soak.snapshot());
  const peakGrowthBytes = Math.max(...samples.map((s) => s.growthBytes));
  const passed =
    errors.length === 0 &&
    final.sessions === 2 &&
    final.attempts === 30 &&
    final.evaluations === 1 &&
    final.safety === 0 &&
    final.saving.status === 'Saved' &&
    peakGrowthBytes <= 50 * 1024 * 1024;
  const result = {
    durationMs: Date.now() - start,
    initialBytes: initial,
    peakGrowthBytes,
    errors,
    final,
    passed,
    samples,
  };
  await writeFile(
    new URL('./soak-result.json', import.meta.url),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify({ passed, peakGrowthBytes, errors, final }));
  await page.evaluate(() => window.soak.dispose());
  if (!passed) process.exitCode = 1;
} finally {
  await browser.close();
}
