import { defineConfig } from '@playwright/test';
import liveConfig from './playwright.config';
export default defineConfig({
  ...liveConfig,
  testDir: '../../../e2e',
  testMatch: 'foundation.spec.ts',
});
