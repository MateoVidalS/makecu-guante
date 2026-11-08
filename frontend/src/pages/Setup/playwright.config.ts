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
    command: 'make -C .. demo-seed && make -C .. dev-sim',
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
  },
});
