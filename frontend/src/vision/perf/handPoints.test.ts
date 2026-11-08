import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  applyJoints,
  createHandRig,
  FINGERS,
  HAND_PROPORTIONS,
} from '../../hand3d/rig';
import { fingerMap } from '../flex';
import { addHandPoints } from './handPoints';

describe('bare-hand benchmark points', () => {
  it.each(['left', 'right'] as const)(
    'keeps small dorsal guides and anchors attached as the %s hand curls',
    (hand) => {
      const rig = createHandRig(hand);
      const points = addHandPoints(rig);
      expect(points).toHaveLength(15);
      for (const finger of FINGERS) {
        const guides = points.filter((point) =>
          point.name.startsWith(`${finger}-guide`),
        );
        expect(guides).toHaveLength(2);
        const segments = finger === 'thumb' ? [1, 2] : [0, 1];
        guides.forEach((point, k) => {
          const i = segments[k];
          expect(point.parent).toBe(rig.fingers[finger].joints[i]);
          expect(point.position.y).toBe(
            HAND_PROPORTIONS[finger].lengths[i] / 2,
          );
          expect(point.material.color.getHexString()).toBe('080808');
        });
        const anchor = points.find(
          (point) => point.name === `${finger}-anchor`,
        )!;
        expect(anchor.parent).toBe(rig.fingers[finger].tip);
        expect(anchor.material.color.getHexString()).toBe('ffdc00');
      }
      for (const point of points) {
        expect(point.position.z).toBeLessThan(0);
        expect(point.geometry.parameters.radius).toBeLessThan(
          HAND_PROPORTIONS.pinky.radius / 2,
        );
      }
      rig.updateMatrixWorld(true);
      const before = points.map((point) =>
        point.getWorldPosition(new Vector3()),
      );
      applyJoints(
        rig,
        fingerMap(() => ({ mcp: 40, pip: 50, dip: 30 })),
      );
      rig.updateMatrixWorld(true);
      points.forEach((point, i) => {
        expect(
          point.getWorldPosition(new Vector3()).distanceTo(before[i]),
        ).toBeGreaterThan(0.01);
        const dorsal = point.parent!.localToWorld(new Vector3(0, 0, -1));
        const origin = point.parent!.getWorldPosition(new Vector3());
        const offset = point.getWorldPosition(new Vector3()).sub(origin);
        expect(offset.dot(dorsal.sub(origin))).toBeGreaterThan(0);
      });
    },
  );
});
