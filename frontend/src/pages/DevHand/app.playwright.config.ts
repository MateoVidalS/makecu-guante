import { defineConfig } from '@playwright/test';
import app from '../../../playwright.config';

const frontend = new URL('../../..', import.meta.url).pathname;
const servers = Array.isArray(app.webServer) ? app.webServer : [app.webServer!];

/** Run the app's unchanged E2E suite with the gallery's macOS GPU settings.
 * Run separately from Vitest to isolate Vite's dependency optimization.
 */
export default defineConfig({
  ...app,
  testDir: new URL('../../../e2e', import.meta.url).pathname,
  workers: 1,
  webServer: servers.map((server) => ({ ...server, cwd: frontend })),
  projects: app.projects?.map((project) => ({
    ...project,
    use: {
      ...project.use,
      launchOptions: {
        ...project.use?.launchOptions,
        args: [
          ...(project.use?.launchOptions?.args ?? []),
          ...(process.platform === 'darwin'
            ? ['--use-gl=angle', '--use-angle=metal']
            : []),
        ],
      },
    },
  })),
});
