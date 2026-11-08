import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

// Reuse the renderer already shipped with the pinned Remotion CLI.
const cliRequire = createRequire(import.meta.resolve('@remotion/cli'));
const { openBrowser, renderStill, selectComposition } = cliRequire('@remotion/renderer');
const serveUrl = path.resolve(process.argv[2] ?? 'out/v5-bundle');
const timelineSource = await readFile(new URL('../../timeline.ts', import.meta.url), 'utf8');
const timelineJs = ts.transpileModule(timelineSource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { SCENE_START, TOTAL_FRAMES } = await import(`data:text/javascript;base64,${Buffer.from(timelineJs).toString('base64')}`);
console.log(`Evidence timeline: ${TOTAL_FRAMES} frames`);
await mkdir('evidence/V5', { recursive: true });
await mkdir('out/v5-review', { recursive: true });
const browser = await openBrowser('chrome');
const compositions = new Map();
const jobs = [
  ['scene-session', 132, 'out/v5-review/standalone-session.png'],
  ['scene-coach', 340, 'out/v5-review/standalone-coach.png'],
  ['scene-doctor', 390, 'out/v5-review/standalone-doctor.png'],
  ['Main', SCENE_START.session + 54, 'out/v5-review/session-innovation.png'],
  ['Main', SCENE_START.session + 132, 'out/v5-review/session-callouts.png'],
  ['Main', SCENE_START.session + 240, 'out/v5-review/session-vision.png'],
  ['Main', SCENE_START.session + 420, 'out/v5-review/session-assist.png'],
  ['Main', SCENE_START.session + 700, 'evidence/V5/session-legend.png'],
  ['Main', SCENE_START.session + 1026, 'evidence/V5/session-resist.png'],
  ['Main', SCENE_START.coach + 90, 'out/v5-review/coach-panel.png'],
  ['Main', SCENE_START.coach + 340, 'out/v5-review/coach-dialog.png'],
  ['Main', SCENE_START.doctor + 390, 'out/v5-review/doctor-summary.png'],
  ...[48, 54, 59].map((frame) => ['scene-session', frame, `out/v5-review/zoom-${frame}.png`]),
  ['scene-session', 1200, 'out/v5-review/session-rule.png'],
  ['scene-session', 1151, 'out/v5-review/session-before-rule.png'],
  ['scene-session', 1295, 'out/v5-review/session-last-frame.png'],
  ['scene-coach', 90, 'out/v5-review/coach-undo.png'],
  ['scene-coach', 503, 'out/v5-review/coach-last-frame.png'],
  ['Main', SCENE_START.doctor + 120, 'out/v5-review/doctor-history.png'],
  ['Main', SCENE_START.doctor + 244, 'out/v5-review/doctor-replay.png'],
  ['Main', SCENE_START.doctor + 290, 'out/v5-review/doctor-current.png'],
  ['scene-doctor', 584, 'out/v5-review/doctor-export.png'],
  ['scene-doctor', 660, 'out/v5-review/doctor-honesty.png'],
  ['scene-doctor', 719, 'out/v5-review/doctor-last-frame.png'],
  ['Main', SCENE_START.session + 132, 'out/v5-review/main-session.png'],
  ['Main', SCENE_START.coach + 340, 'out/v5-review/main-coach.png'],
  ['Main', SCENE_START.doctor + 390, 'out/v5-review/main-doctor.png'],
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
