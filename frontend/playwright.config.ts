import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const frontendPort = process.env.REHAB_FRONTEND_PORT ?? '5178';
const apiPort = process.env.REHAB_PORT ?? '8008';
const baseURL = `http://127.0.0.1:${frontendPort}`;
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Leave CPU headroom for concurrent 3D scenes and wall-time recovery checks.
  workers: Number(process.env.REHAB_E2E_WORKERS ?? 3),
  use: { baseURL, trace: 'retain-on-failure', actionTimeout: 10_000 },
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
    timeout: 180_000,
    command:
      process.env.REHAB_E2E_MOCK === '1'
        ? 'make -C .. dev-mock'
        : 'make -C .. demo-seed && make -C .. dev-sim',
    env: {
      REHAB_FRONTEND_PORT: frontendPort,
      REHAB_PORT: apiPort,
      REHAB_DB_PATH: join(tmpdir(), `rehab-e2e-${process.pid}.db`),
      GEMINI_API_KEY: '',
      VITE_SIM_SPEED: '3',
      VITE_MOCK_API: process.env.REHAB_E2E_MOCK === '1' ? '1' : '0',
    },
    url: baseURL,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
});
