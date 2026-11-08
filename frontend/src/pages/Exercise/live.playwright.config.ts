import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  testDir: '.',
  testMatch: 'live.browser.spec.ts',
  workers: 1,
  timeout: 240_000,
  outputDir: '/tmp/rehab-u4-browser',
  use: {
    baseURL: 'http://127.0.0.1:5294',
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'REHAB_FRONTEND_PORT=5294 REHAB_VITE_CACHE_DIR=node_modules/.vite-u4-layout make dev-mock',
    cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
    url: 'http://127.0.0.1:5294',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
