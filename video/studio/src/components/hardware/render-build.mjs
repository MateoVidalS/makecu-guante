// From video/studio: node src/components/hardware/render-build.mjs [step ...] [--video]
// Bundle once and reuse the browser for evidence; avoid concurrent software-WebGL jobs.
import { createRequire } from 'node:module';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const cliRequire = createRequire(require.resolve('@remotion/cli'));
const { bundle } = cliRequire('@remotion/bundler');
const { openBrowser, selectComposition, renderStill, renderMedia } = cliRequire('@remotion/renderer');
const args = process.argv.slice(2);
const selected = args.filter((arg) => !arg.startsWith('--'));
const steps = [
  ['module', 15], ['servos', 106], ['spools', 196], ['electronics', 215],
  ['cables', 233], ['lid', 251], ['threads', 287],
];
await mkdir('evidence/V4', { recursive: true });
await mkdir('out', { recursive: true });
console.log('Bundling scene-build once…');
const serveUrl = await bundle({ entryPoint: resolve('src/index.ts'), publicDir: resolve('public') });
const chromiumOptions = { gl: 'angle' };
const browser = await openBrowser('chrome', { chromiumOptions });
try {
  const composition = await selectComposition({ serveUrl, id: 'scene-build', puppeteerInstance: browser, chromiumOptions });
  const shared = { serveUrl, composition, puppeteerInstance: browser, chromiumOptions, timeoutInMilliseconds: 120000, logLevel: 'error' };
  if (!args.includes('--video-only')) {
    for (const [step, frame] of steps) {
      if (selected.length && !selected.includes(step)) continue;
      const start = performance.now();
      await renderStill({ ...shared, frame, imageFormat: 'png', output: `evidence/V4/build-${step}.png` });
      console.log(`${step}: frame ${frame}, ${Math.round(performance.now() - start)} ms`);
    }
  }
  if (args.includes('--video') || args.includes('--video-only')) {
    const start = performance.now();
    let last = -1;
    await renderMedia({ ...shared, outputLocation: 'out/v4-build.mp4', codec: 'h264', concurrency: 1, imageFormat: 'jpeg', jpegQuality: 92,
      onProgress: ({ renderedFrames }) => {
        const beat = Math.floor(renderedFrames / 36);
        if (beat !== last) { last = beat; console.log(`Build render: ${renderedFrames}/288 frames`); }
      },
    });
    const elapsed = performance.now() - start;
    console.log(`Build video: ${Math.round(elapsed)} ms / 288 frames = ${(elapsed / 288).toFixed(1)} ms/frame (including renderer setup and encoding; bundle excluded)`);
  }
} finally {
  await browser.close({ silent: true });
  await rm(serveUrl, { recursive: true, force: true });
}
