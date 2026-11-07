import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: '*.browser.spec.ts',
  timeout: 60000,
  workers: 1,
  outputDir: '/tmp/rehab-wp7-browser',
  use: {
    baseURL: 'http://127.0.0.1:5277',
    browserName: 'chromium',
    headless: true,
  },
  webServer: {
    command: 'VITE_MOCK_API=1 VITE_SIM=1 pnpm dev --port 5277 --strictPort',
    url: 'http://127.0.0.1:5277',
    reuseExistingServer: false,
  },
});
