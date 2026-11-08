import { describe, expect, it } from 'vitest';
import { Group, OrthographicCamera, Vector3 } from 'three';
import { POSES } from '../contracts/poses';
import { tokens } from '../styles/tokens';
import { applyJoints } from './rig';
import { createHandScene } from './scene';
import {
  fitHandViewport,
  handFamilyBounds,
  HAND_VIEW_FILL,
  projectedHandBounds,
} from './framing';
import { handPresentation } from './view';

describe('stable family framing', () => {
  for (const view of ['front_upright', 'front_diagonal'] as const) {
    for (const hand of ['left', 'right'] as const) {
      for (const [width, height] of [
        [810, 360],
        [920, 480],
        [240, 240],
        [360, 640],
      ]) {
        it(`${view}, ${hand}: fits every pose and its ghost in ${width}×${height}`, () => {
          const scene = createHandScene(hand, tokens.light);
          const root = new Group();
          root.add(scene.actual, scene.target);
          try {
            for (const pose of Object.values(POSES)) {
              const bounds = handFamilyBounds(hand, pose.family, view);
              const fit = fitHandViewport(bounds, width, height);
              const camera = new OrthographicCamera(
                -width / 2,
                width / 2,
                height / 2,
                -height / 2,
                0.1,
                50,
              );
              const presentation = handPresentation(
                hand,
                view,
                pose.family === 'pinch',
              );
              root.rotation.set(...presentation.rotation);
              camera.position.set(...presentation.camera);
              camera.lookAt(...presentation.lookAt);
              // Bounds are in the unshifted camera's plane.
              applyJoints(scene.actual, pose.render);
              applyJoints(scene.target, pose.render);
              const projected = projectedHandBounds(root, camera);
              for (const x of [projected.min.x, projected.max.x])
                expect(
                  Math.abs(((x - fit.centerX) * fit.zoom) / (width / 2)),
                ).toBeLessThanOrEqual(HAND_VIEW_FILL + 1e-6);
              for (const y of [projected.min.y, projected.max.y])
                expect(
                  Math.abs(((y - fit.centerY) * fit.zoom) / (height / 2)),
                ).toBeLessThanOrEqual(HAND_VIEW_FILL + 1e-6);
              const size = bounds.getSize(new Vector3());
              expect(
                Math.max(
                  (size.x * fit.zoom) / width,
                  (size.y * fit.zoom) / height,
                ),
              ).toBeCloseTo(HAND_VIEW_FILL);
              // The same family always returns the same envelope and center.
              expect(handFamilyBounds(hand, pose.family, view)).toBe(bounds);
              // Coach contours fit the reserved margin without reframing the pose.
              for (const meshes of scene.focusMeshes)
                for (const mesh of meshes) mesh.visible = true;
              const focused = projectedHandBounds(root, camera);
              for (const x of [focused.min.x, focused.max.x])
                expect(
                  Math.abs(((x - fit.centerX) * fit.zoom) / (width / 2)),
                ).toBeLessThan(1);
              for (const y of [focused.min.y, focused.max.y])
                expect(
                  Math.abs(((y - fit.centerY) * fit.zoom) / (height / 2)),
                ).toBeLessThan(1);
              for (const meshes of scene.focusMeshes)
                for (const mesh of meshes) mesh.visible = false;
            }
          } finally {
            scene.dispose();
          }
        });
      }
    }
  }
});
