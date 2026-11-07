import { describe, expect, it } from 'vitest';
import { Color } from 'three';
import { POSES } from '../contracts/poses';
import { tokens } from '../styles/tokens';
import { FINGERS } from './rig';
import { createHandScene, STATE_TINT } from './scene';
import { createHandAnimator } from './animation';

describe('coach finger highlight', () => {
  for (const theme of ['light', 'dark'] as const)
    for (const reduced of [false, true])
      it(`${theme}, reduced motion ${reduced}: selects any finger without flashing or changing other state colors`, () => {
        const palette = tokens[theme];
        const scene = createHandScene('right', palette);
        const animator = createHandAnimator(scene, palette);
        try {
          expect(
            scene.focusMaterial.color.equals(new Color(palette.text)),
          ).toBe(true);
          animator.tick(
            POSES.open.render,
            () => 'active',
            true,
            reduced,
            1 / 60,
          );
          expect(scene.focusMeshes.flat().every((mesh) => !mesh.visible)).toBe(
            true,
          );
          for (const finger of FINGERS) {
            for (let frame = 0; frame < 60; frame++) {
              animator.tick(
                POSES.open.render,
                () => 'assist',
                true,
                reduced,
                1 / 60,
                false,
                finger,
              );
              for (let index = 0; index < FINGERS.length; index++) {
                const selected = FINGERS[index] === finger;
                expect(
                  scene.focusMeshes[index].every(
                    (mesh) => mesh.visible === selected,
                  ),
                ).toBe(true);
                const expected = new Color(palette.hand).lerp(
                  new Color(palette.assist),
                  selected ? 1 : STATE_TINT,
                );
                expect(scene.fingers[index].color.equals(expected)).toBe(true);
              }
              expect(scene.focusMaterial.opacity).toBe(1);
              expect(animator.rimIntensity).toBe(0);
            }
          }
          animator.tick(null, () => 'idle', true, true, 1 / 60, false, 'index');
          expect(scene.focusMaterial.opacity).toBe(0.3);
          animator.tick(
            POSES.open.render,
            () => 'idle',
            true,
            reduced,
            1 / 60,
            false,
            null,
          );
          expect(scene.focusMeshes.flat().every((mesh) => !mesh.visible)).toBe(
            true,
          );
          for (const material of scene.fingers)
            expect(material.color.equals(new Color(palette.hand))).toBe(true);
        } finally {
          scene.dispose();
        }
      });
});
