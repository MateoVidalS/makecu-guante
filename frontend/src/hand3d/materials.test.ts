import { describe, expect, it } from 'vitest';
import { Color, MeshBasicMaterial } from 'three';
import { tokens } from '../styles/tokens';
import { POSES } from '../contracts/poses';
import {
  createHandScene,
  GHOST_OPACITY,
  STATE_TINT,
  type FingerState,
} from './scene';
import { createHandAnimator } from './animation';

describe('legible hand materials', () => {
  for (const theme of ['light', 'dark'] as const)
    it(`${theme}: maps every state to a strong tint on all five fingers`, () => {
      const palette = tokens[theme];
      const scene = createHandScene('right', palette);
      const animator = createHandAnimator(scene, palette);
      try {
        expect(scene.ghost).toBeInstanceOf(MeshBasicMaterial);
        expect(scene.outline).toBeInstanceOf(MeshBasicMaterial);
        expect(scene.ghost.color.getHexString()).toBe(
          palette.target.slice(1).toLowerCase(),
        );
        expect(GHOST_OPACITY).toBe(0.35);
        expect(scene.target.scale.x).toBeCloseTo(1.03);
        expect(STATE_TINT).toBeGreaterThanOrEqual(0.85);
        for (const state of [
          'idle',
          'active',
          'assist',
          'reached',
        ] as FingerState[]) {
          animator.tick(
            POSES.open.render,
            () => state,
            true,
            true,
            1 / 60,
            true,
          );
          const expected = new Color(palette.hand);
          if (state !== 'idle')
            expected.lerp(new Color(palette[state]), STATE_TINT);
          for (const material of scene.fingers) {
            expect(material.color.equals(expected)).toBe(true);
            expect(material.opacity).toBe(1);
          }
          expect(scene.ghost.opacity).toBe(GHOST_OPACITY);
          expect(scene.palm.color.equals(new Color(palette.hand))).toBe(true);
        }
      } finally {
        scene.dispose();
      }
    });
});
