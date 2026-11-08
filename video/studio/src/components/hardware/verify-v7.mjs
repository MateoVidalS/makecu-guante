// From video/studio: node src/components/hardware/verify-v7.mjs
// Check the entire 288-frame choreography and independently ray-check CAD-to-screen projection.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const temporary = mkdtempSync(join(tmpdir(), 'memo-v7-'));
try {
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--target', 'ES2022',
    '--module', 'commonjs', '--moduleResolution', 'node', '--outDir', temporary, '--rootDir', resolve('../..'),
    '--noEmit', 'false', '--jsx', 'react', '--esModuleInterop', 'true', '--skipLibCheck',
    'src/components/hardware/BuildCallouts.tsx'], { stdio: 'inherit' });
  symlinkSync(resolve('node_modules'), join(temporary, 'node_modules'), 'dir');
  const compiled = join(temporary, 'video/studio/src/components/hardware');
  const { buildCallouts } = require(join(compiled, 'BuildCallouts.js'));
  const { projectBuildPoint, buildView, aimCamera } = require(join(compiled, 'buildMotion.js'));
  const { Matrix4, OrthographicCamera, Raycaster, Vector2, Vector3 } = require('three');
  const width = 1920, height = 760, canvasTop = 64;
  const rotate = new Matrix4().makeRotationX(-Math.PI / 2);
  for (const callout of buildCallouts) {
    assert.equal(callout.at % 18, 0, `${callout.id} enters on a beat`);
    assert.ok(callout.top + canvasTop >= 64);
    assert.ok(callout.top + canvasTop + 146 <= 880, `${callout.id} clears captions`);
    assert.ok(callout.left >= 96 && callout.left + callout.width <= width - 96);
  }
  for (let frame = 0; frame < 288; frame++) {
    const active = buildCallouts.filter((item) => frame >= item.at && frame < item.until);
    assert.ok(active.length <= 2, `Frame ${frame}: at most two callouts`);
    if (active.length === 2) {
      const [a, b] = active;
      assert.ok(a.top + 146 <= b.top || b.top + 146 <= a.top ||
        a.left + a.width <= b.left || b.left + b.width <= a.left, `Frame ${frame}: pills never overlap`);
    }
    const camera = new OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 1, 1200);
    aimCamera(camera, buildView(frame, width, height));
    for (const callout of active) {
      const point = projectBuildPoint(frame, width, height, callout.point(frame));
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
      const ray = new Raycaster();
      ray.setFromCamera(new Vector2(point.x / width * 2 - 1, 1 - point.y / height * 2), camera);
      const world = new Vector3(...callout.point(frame)).applyMatrix4(rotate);
      assert.ok(ray.ray.distanceToPoint(world) < 1e-6, `Frame ${frame}: ${callout.id} locks to its CAD point`);
      // Arrival drops can start above the canvas; the overlay clips them below the chapter reserve.
      if (frame >= callout.at + 6) {
        assert.ok(point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height,
          `Frame ${frame}: ${callout.id} endpoint remains visible after the line draws`);
      }
    }
  }
  const servo = buildCallouts.find((item) => item.id === 'servos');
  const orbit = [60, 78, 96].map((frame) => projectBuildPoint(frame, width, height, servo.point(frame)));
  assert.ok(Math.hypot(orbit[2].x - orbit[0].x, orbit[2].y - orbit[0].y) > 5, 'Orbit evidence shows a changing projection');
  console.log('V7: all 288 frames pass beat, reserve, overlap, visibility and CAD ray-projection checks.');
  console.log('Servo endpoint at orbit evidence frames 60 / 78 / 96:', orbit);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
