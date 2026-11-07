import { describe, expect, it } from 'vitest';
import { Euler, Vector3 } from 'three';
import { palmDownCamera, HAND_LOOK_AT, PALM_DOWN_ROTATION } from './view';
import { tokens } from '../styles/tokens';
import { contrast } from '../design-system/contrast';

describe('palm-down thumb-side camera', () => {
  it('views the dorsal side from the front diagonal and mirrors for the left hand', () => {
    for (const pinch of [false, true]) {
      const right = palmDownCamera('right', pinch);
      const left = palmDownCamera('left', pinch);
      expect(left).toEqual([-right[0], right[1], right[2]]);
      expect(right[0]).toBeLessThan(0);
      expect(right[1]).toBeGreaterThan(HAND_LOOK_AT[1]);
      expect(
        new Vector3(...right)
          .sub(new Vector3(...HAND_LOOK_AT))
          .dot(
            new Vector3(0, 0, 1).applyEuler(new Euler(...PALM_DOWN_ROTATION)),
          ),
      ).toBeLessThan(0);
    }
  });
});

describe('new finger palette', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}: ring and pinky graphics exceed 3:1 on chart surfaces`, () => {
      const palette = tokens[theme];
      for (const finger of [palette.fingerRing, palette.fingerPinky])
        for (const surface of [palette.bg, palette.surface, palette.surface2])
          expect(contrast(finger, surface)).toBeGreaterThanOrEqual(3);
      expect(
        new Set([
          palette.fingerThumb,
          palette.fingerIndex,
          palette.fingerMiddle,
          palette.fingerRing,
          palette.fingerPinky,
        ]).size,
      ).toBe(5);
    });
  }
});
