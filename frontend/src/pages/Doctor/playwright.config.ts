import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'history-doctor.spec.ts',
  outputDir: '/tmp/rehab-wp9-e2e',
  fullyParallel: false,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command:
      'VITE_MOCK_API=1 VITE_SIM=1 pnpm exec vite --host 127.0.0.1 --port 5174 --strictPort',
    cwd: new URL('../../..', import.meta.url).pathname,
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: !process.env.CI,
  },
});
