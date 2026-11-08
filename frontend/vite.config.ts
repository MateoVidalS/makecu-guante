import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  cacheDir: process.env.REHAB_VITE_CACHE_DIR ?? 'node_modules/.vite',
  optimizeDeps: { include: ['@mediapipe/tasks-vision'] },
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
  },
});
