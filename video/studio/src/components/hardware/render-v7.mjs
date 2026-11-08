// From video/studio: node src/components/hardware/render-v7.mjs [name ...]
// Sequential WebGL renders, one bundle/browser, with the real scene captions.
import { createRequire } from 'node:module';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const cliRequire = createRequire(require.resolve('@remotion/cli'));
const { bundle } = cliRequire('@remotion/bundler');
const { openBrowser, selectComposition, renderStill } = cliRequire('@remotion/renderer');
const selected = process.argv.slice(2);
const frames = [
  ['servos-orbit-060', 60], ['servos-orbit-078', 78], ['servos-orbit-096', 96],
  ['spools-150', 150], ['esp32-195', 195], ['sensor-213', 213],
  ['stop-231', 231], ['guides-275', 275], ['final-hand-287', 287],
];
await mkdir('evidence/V7', { recursive: true });
const serveUrl = await bundle({ entryPoint: resolve('src/index.ts'), publicDir: resolve('public') });
const chromiumOptions = { gl: 'angle' };
const browser = await openBrowser('chrome', { chromiumOptions });
try {
  const composition = await selectComposition({ serveUrl, id: 'scene-build', puppeteerInstance: browser, chromiumOptions });
  for (const [name, frame] of frames) {
    if (selected.length && !selected.includes(name)) continue;
    await renderStill({ serveUrl, composition, puppeteerInstance: browser, chromiumOptions, frame,
      timeoutInMilliseconds: 120000, imageFormat: 'png', output: `evidence/V7/${name}.png`, logLevel: 'error' });
    console.log(`${name}: frame ${frame}`);
  }
} finally {
  await browser.close({ silent: true });
  await rm(serveUrl, { recursive: true, force: true });
}
