import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'live.browser.spec.ts',
  workers: 1,
  timeout: 120_000,
  outputDir: '/tmp/rehab-u4-browser',
  use: {
    baseURL: 'http://127.0.0.1:5294',
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'REHAB_FRONTEND_PORT=5294 make -C .. dev-mock',
    url: 'http://127.0.0.1:5294',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
