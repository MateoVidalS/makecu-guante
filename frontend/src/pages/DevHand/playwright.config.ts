import { defineConfig, devices } from '@playwright/test';
const port = process.env.REHAB_FRONTEND_PORT ?? '5173';
export default defineConfig({
  testDir: '.',
  testMatch: 'gallery.browser.spec.ts',
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  outputDir: '../../../test-results/hand',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 1100 },
    launchOptions: {
      args: [
        // Headless macOS otherwise defaults to CPU-only SwiftShader.
        ...(process.platform === 'darwin'
          ? ['--use-gl=angle', '--use-angle=metal']
          : []),
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
      ],
    },
  },
  webServer: {
    command: 'pnpm dev',
    cwd: new URL('../../..', import.meta.url).pathname,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
