import { defineConfig, devices } from '@playwright/test';
const port = process.env.REHAB_U3_PORT ?? '5195';
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: '.',
  testMatch: 'history-doctor.spec.ts',
  outputDir: '/tmp/rehab-wp9-e2e',
  fullyParallel: false,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `VITE_MOCK_API=1 VITE_SIM=1 VITE_SIM_SPEED=3 pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: new URL('../../..', import.meta.url).pathname,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
