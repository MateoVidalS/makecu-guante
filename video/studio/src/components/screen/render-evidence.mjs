import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

// Reuse the renderer already shipped with the pinned Remotion CLI.
const cliRequire = createRequire(import.meta.resolve('@remotion/cli'));
const { openBrowser, renderStill, selectComposition } = cliRequire('@remotion/renderer');
const serveUrl = path.resolve('out/v5-bundle');
await mkdir('evidence/V5', { recursive: true });
await mkdir('out/v5-review', { recursive: true });
const browser = await openBrowser('chrome');
const compositions = new Map();
const jobs = [
  ['scene-session', 90, 'evidence/V5/session-callouts.png'],
  ['scene-session', 700, 'evidence/V5/session-legend.png'],
  ['scene-session', 1026, 'evidence/V5/session-resist.png'],
  ['scene-coach', 300, 'evidence/V5/coach-split.png'],
  ['scene-doctor', 570, 'out/v5-review/doctor-summary.png'],
  ...[48, 54, 59].map((frame) => ['scene-session', frame, `out/v5-review/zoom-${frame}.png`]),
  ['scene-session', 420, 'out/v5-review/session-assist.png'],
  ['scene-session', 1260, 'out/v5-review/session-rule.png'],
  ['scene-session', 1223, 'out/v5-review/session-before-rule.png'],
  ['scene-session', 1367, 'out/v5-review/session-last-frame.png'],
  ['scene-coach', 90, 'out/v5-review/coach-undo.png'],
  ['scene-coach', 520, 'out/v5-review/coach-rule.png'],
  ['scene-doctor', 200, 'out/v5-review/doctor-history.png'],
  ['scene-doctor', 380, 'out/v5-review/doctor-replay.png'],
  ['scene-doctor', 450, 'out/v5-review/doctor-current.png'],
  ['scene-doctor', 672, 'out/v5-review/doctor-export.png'],
  ['scene-doctor', 780, 'out/v5-review/doctor-honesty.png'],
  ['Main', 1314, 'out/v5-review/main-session.png'],
  ['Main', 2892, 'out/v5-review/main-coach.png'],
  ['Main', 3738, 'out/v5-review/main-doctor.png'],
];
try {
  for (const [id, frame, output] of jobs) {
    if (!compositions.has(id)) compositions.set(id, await selectComposition({ serveUrl, id, puppeteerInstance: browser }));
    await renderStill({ serveUrl, composition: compositions.get(id), frame, output, imageFormat: 'png', puppeteerInstance: browser, overwrite: true });
    console.log(`${id} f${frame} → ${output}`);
  }
} finally {
  await browser.close({ silent: true });
}
