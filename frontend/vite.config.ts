import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.REHAB_FRONTEND_PORT ?? 5173),
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.REHAB_PORT ?? 8000}` },
  },
  build: { outDir: '../backend/static', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    // Shared hosts can extend runner/UI-loading waits without changing assertions.
    testTimeout: Number(process.env.REHAB_TEST_TIMEOUT_MS ?? 5000),
    setupFiles: process.env.REHAB_TEST_TIMEOUT_MS
      ? ['./e2e/test-waits.setup.ts']
      : [],
  },
});
