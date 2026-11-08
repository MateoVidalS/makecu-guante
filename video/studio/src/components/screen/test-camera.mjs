import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// Load the actual TS implementation with existing dependencies; no test-runner dependency needed.
async function loadTs(file) {
  const source = await readFile(file, 'utf8');
  let js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const imports = [...js.matchAll(/from ['"]([^'"]+)['"]/g)];
  for (const [, specifier] of imports) {
    const resolved = specifier.startsWith('.')
      ? await loadTs(path.resolve(path.dirname(file), `${specifier}.ts`))
      : import.meta.resolve(specifier);
    js = js.replace(`from '${specifier}'`, `from '${resolved}'`).replace(`from "${specifier}"`, `from '${resolved}'`);
  }
  return `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
}
const { cameraAt, findEvent, fitViewport, mapPoint, targetBox } = await import(await loadTs(fileURLToPath(new URL('./camera.ts', import.meta.url))));
const { recordingForScreen, clipFrameAt } = await import(await loadTs(fileURLToPath(new URL('./recording.ts', import.meta.url))));
const clip = { width: 1440, height: 900, events: [
  { frame: 0, kind: 'focus', label: 'focus:hand', point: { x: 400, y: 300 }, box: { x: 300, y: 200, w: 200, h: 200 } },
  { frame: 60, kind: 'focus', label: 'focus:hand', point: { x: 520, y: 360 }, box: { x: 420, y: 260, w: 200, h: 200 } },
] };
const viewport = fitViewport(clip, { x: 64, y: 64, w: 1792, h: 800 });
assert.equal(viewport.h, 800);
assert.equal(viewport.w, 1280);
const keys = [{ at: 0, target: 'focus:hand', zoom: 1 }, { at: 36, target: 'focus:hand', zoom: 1.6 }];
const cameras = [36, 48, 54, 59, 60].map((frame) => cameraAt(clip, keys, frame, frame, viewport));
assert.equal(cameras[0].zoom, 1);
assert.equal(cameras.at(-1).zoom, 1.6);
assert.ok(cameras[1].zoom > 1 && cameras[1].zoom < cameras[2].zoom);
for (let frame = 0; frame <= 120; frame++) {
  const camera = cameraAt(clip, keys, frame, frame, viewport);
  assert.ok(camera.x <= viewport.x + 1e-8);
  assert.ok(camera.y <= viewport.y + 1e-8);
  assert.ok(camera.x + clip.width * camera.scale >= viewport.x + viewport.w - 1e-8);
  assert.ok(camera.y + clip.height * camera.scale >= viewport.y + viewport.h - 1e-8);
  const anchor = findEvent(clip, 'focus:hand', frame).point;
  const screen = mapPoint(anchor, camera);
  assert.ok(Math.abs((screen.x - camera.x) / camera.scale - anchor.x) < 1e-8);
  assert.ok(Math.abs((screen.y - camera.y) / camera.scale - anchor.y) < 1e-8);
}
assert.deepEqual(findEvent(clip, 'focus:hand', 30).point, { x: 460, y: 330 });
assert.equal(cameraAt(clip, [{ at: 0, target: { x: 0, y: 0, w: 1, h: 1 }, zoom: 9 }], 0, 0, viewport).zoom, 2.2);
assert.equal(cameraAt(clip, [{ at: 0, target: 'missing', zoom: 0 }], 0, 0, viewport).zoom, 1);
const hd = { ...clip, width: 3840, height: 2160, events: [] };
assert.equal(fitViewport(hd, { x: 64, y: 64, w: 1792, h: 800 }).h, 800);
assert.equal(cameraAt(hd, [], 0, 0, fitViewport(hd, { x: 64, y: 64, w: 1792, h: 800 })).zoom, 1);
const history = { ...clip, events: [
  { frame: 0, kind: 'focus', label: 'focus:then', box: { x: 175, y: 330, w: 200, h: 250 } },
  { frame: 0, kind: 'focus', label: 'focus:now', box: { x: 455, y: 330, w: 200, h: 250 } },
] };
assert.deepEqual(targetBox(history, 'focus:then-now', 0), { x: 175, y: 330, w: 480, h: 250 });
const paired = cameraAt(history, [{ at: 0, target: 'focus:then-now', zoom: 2 }], 200, 200, viewport);
assert.equal(mapPoint({ x: 415, y: 455 }, paired).x, viewport.x + viewport.w / 2);
const coachArea = { x: 940, y: 96, w: 884, h: 750 };
const filled = cameraAt(clip, [{ at: 0, target: 'focus:hand', zoom: 1.8 }], 0, 0, coachArea);
assert.ok(filled.x + clip.width * filled.scale >= coachArea.x + coachArea.w);
assert.ok(filled.y + clip.height * filled.scale >= coachArea.y + coachArea.h);
const recording = { ...hd, fps: 30, durationFrames: 1350, events: [
  { frame: 0, kind: 'phase', label: 'phase:PRESENT' },
  { frame: 374, kind: 'phase', label: 'phase:ATTEMPT' },
  { frame: 600, kind: 'phase', label: 'phase:ASSIST' },
  { frame: 1051, kind: 'phase', label: 'phase:ASSIST_HOLD' },
  { frame: 0, kind: 'focus', label: 'focus:virtual-hand', box: { x: 50, y: 353, w: 2910, h: 1621 } },
  { frame: 0, kind: 'focus', label: 'focus:index-fingertip-approximate', point: { x: 1476, y: 985 } },
  { frame: 0, kind: 'focus', label: 'focus:coach-adjustment', box: { x: 3010, y: 1682, w: 782, h: 254 } },
] };
const original = JSON.stringify(recording);
const adapted = recordingForScreen(recording);
assert.equal(JSON.stringify(recording), original);
assert.deepEqual(findEvent(adapted, 'focus:index', 0).point, { x: 1476, y: 985 });
assert.equal(findEvent(adapted, 'focus:coach-decision', 0).box.w, 782);
assert.ok(findEvent(adapted, 'focus:ghost', 0).point);
const timing = [
  { at: 0, event: 'phase:PRESENT', fallback: 0 },
  { at: 144, event: 'phase:ATTEMPT', fallback: 144 },
  { at: 360, event: 'phase:ASSIST', fallback: 360 },
  { at: 540, event: 'phase:ASSIST_HOLD', fallback: 540 },
  { at: 612, event: 'phase:ASSIST_HOLD', fallback: 540, offset: 90 },
];
assert.equal(clipFrameAt(adapted, 144, 0, timing), 374);
assert.equal(clipFrameAt(adapted, 360, 0, timing), 600);
assert.equal(clipFrameAt(adapted, 540, 0, timing), 1051);
assert.equal(clipFrameAt(adapted, 612, 0, timing), 1141);
assert.equal(clipFrameAt(adapted, 900, 0, timing), 1141);
assert.equal(clipFrameAt(adapted, 2000, 0), 1349);
console.log('camera checks passed: eased zoom, moving anchors, edge clamps, 4K viewport, zoom limits');
