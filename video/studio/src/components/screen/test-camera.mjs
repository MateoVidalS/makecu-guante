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
const { cameraAt, findEvent, fitViewport, mapPoint } = await import(await loadTs(fileURLToPath(new URL('./camera.ts', import.meta.url))));
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
console.log('camera checks passed: eased zoom, moving anchors, edge clamps, 4K viewport, zoom limits');
