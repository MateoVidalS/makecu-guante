import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'therapy.browser.spec.ts',
  workers: 1,
  timeout: 60000,
  outputDir: '/tmp/rehab-a4-browser',
  use: {
    baseURL: 'http://127.0.0.1:5284',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'VITE_MOCK_API=1 VITE_SIM=1 VITE_SIM_SPEED=3 pnpm dev --port 5284 --strictPort',
    url: 'http://127.0.0.1:5284',
    reuseExistingServer: false,
  },
});
