import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const frontendPort = process.env.REHAB_FRONTEND_PORT ?? '5178';
const apiPort = process.env.REHAB_PORT ?? '8008';
const baseURL = `http://127.0.0.1:${frontendPort}`;
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
          ],
        },
      },
    },
  ],
  webServer: {
    command:
      process.env.REHAB_E2E_MOCK === '1'
        ? 'make -C .. dev-mock'
        : 'make -C .. dev-sim',
    env: {
      REHAB_FRONTEND_PORT: frontendPort,
      REHAB_PORT: apiPort,
      REHAB_DB_PATH: join(tmpdir(), `rehab-e2e-${process.pid}.db`),
      GEMINI_API_KEY: '',
      VITE_SIM_SPEED: '3',
    },
    url: baseURL,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
});
