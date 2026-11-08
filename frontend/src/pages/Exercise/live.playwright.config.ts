import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'live.browser.spec.ts',
  workers: 1,
  timeout: 120_000,
  outputDir: '/tmp/rehab-u4-browser',
  use: {
    baseURL: process.env.U4_BASELINE
      ? 'http://127.0.0.1:5293'
      : 'http://127.0.0.1:5294',
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
  },
});
