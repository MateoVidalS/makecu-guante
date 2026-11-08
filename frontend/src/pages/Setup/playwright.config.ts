import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../../../playwright.config';

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: '*.browser.spec.ts',
  outputDir: '/tmp/rehab-u1-helper-browser',
  webServer: {
    ...(!Array.isArray(base.webServer) ? base.webServer : {}),
    // Helper-page scenarios provide their own calibration and need no demo history.
    command: 'make -C .. dev-sim-all',
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
  },
});
