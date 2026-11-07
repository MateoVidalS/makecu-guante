import {
  BackSide,
  BufferGeometry,
  CapsuleGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { tokens } from '../styles/tokens';
import { createHandRig, FINGERS, HAND_PROPORTIONS } from './rig';
import type { Handedness } from '../contracts/vision';
export type HandTheme = typeof tokens.light | typeof tokens.dark;
export type FingerState = 'idle' | 'active' | 'assist' | 'reached';
/** The target is a quiet hint, not a second hand. */
export const GHOST_OPACITY = 0.22;
export const OUTLINE_RATIO = 1.1;
/** How far an active glove finger leans towards its state colour. */
export const STATE_TINT = 0.4;

export function createHandScene(handedness: Handedness, palette: HandTheme) {
  const actual = createHandRig(handedness),
    target = createHandRig(handedness);
  const geometries: BufferGeometry[] = [
    new RoundedBoxGeometry(...HAND_PROPORTIONS.palm, 3, 0.18),
  ];
  const clay = () =>
    new MeshLambertMaterial({
      color: palette.hand,
    });
  const palm = clay();
  const fingers = FINGERS.map(clay);
  const ghost = new MeshLambertMaterial({
    color: palette.target,
    transparent: true,
    opacity: GHOST_OPACITY,
    depthWrite: false,
  });
  // A back-face shell frames the ghost even when the solid hand overlaps it.
  const outline = new MeshLambertMaterial({
    color: palette.target,
    side: BackSide,
    transparent: true,
    opacity: GHOST_OPACITY * OUTLINE_RATIO,
    depthWrite: false,
  });
  const materials = [palm, ...fingers, ghost, outline];
  function attach(
    parent: Group,
    geometry: (typeof geometries)[number],
    material: MeshLambertMaterial,
    y = 0,
    shell = false,
  ) {
    const mesh = new Mesh(geometry, material);
    mesh.position.y = y;
    parent.add(mesh);
    if (shell) {
      const edge = new Mesh(geometry, outline);
      edge.position.y = y;
      edge.scale.setScalar(1.045);
      parent.add(edge);
    }
  }
  attach(actual, geometries[0], palm);
  attach(target, geometries[0], ghost, 0, true);
  const wrist = new CapsuleGeometry(0.3, 0.45, 4, 10);
  wrist.scale(1.8, 1, 0.65);
  geometries.push(wrist);
  attach(actual, wrist, palm, -1.1);
  attach(target, wrist, ghost, -1.1, true);
  for (let f = 0; f < FINGERS.length; f++) {
    const finger = FINGERS[f];
    const dimensions = HAND_PROPORTIONS[finger];
    for (let i = 0; i < 3; i++) {
      const radius = dimensions.radius * (1 - i * 0.12);
      const length = dimensions.lengths[i];
      const geometry = new CapsuleGeometry(radius, length - radius * 2, 4, 10);
      geometries.push(geometry);
      attach(
        actual.fingers[finger].joints[i],
        geometry,
        fingers[f],
        length / 2,
      );
      attach(
        target.fingers[finger].joints[i],
        geometry,
        ghost,
        length / 2,
        true,
      );
    }
  }
  target.scale.multiplyScalar(1.03);
  return {
    actual,
    target,
    palm,
    fingers,
    ghost,
    outline,
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
