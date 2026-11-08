import {
  BackSide,
  BufferGeometry,
  CapsuleGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  MeshBasicMaterial,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { tokens } from '../styles/tokens';
import { createHandRig, FINGERS, HAND_PROPORTIONS } from './rig';
import type { Handedness } from '../contracts/vision';
export type HandTheme = typeof tokens.light | typeof tokens.dark;
/** `stopped`: the glove stopped helping because this finger resisted (caution amber). */
export type FingerState = 'idle' | 'active' | 'assist' | 'reached' | 'stopped';
/** Unlit target remains a flat silhouette beside the shaded actual hand. */
export const GHOST_OPACITY = 0.35;
export const OUTLINE_RATIO = 1.6;
/** How far an active glove finger leans towards its state colour. */
export const STATE_TINT = 0.9;

export function createHandScene(handedness: Handedness, palette: HandTheme) {
  const actual = createHandRig(handedness),
    target = createHandRig(handedness);
  const geometries: BufferGeometry[] = [
    new RoundedBoxGeometry(...HAND_PROPORTIONS.palm, 3, 0.18),
  ];
  const clay = () =>
    new MeshLambertMaterial({
      color: palette.hand,
      transparent: true,
    });
  const palm = clay();
  const fingers = FINGERS.map(clay);
  const ghost = new MeshBasicMaterial({
    color: palette.target,
    transparent: true,
    opacity: GHOST_OPACITY,
    depthWrite: false,
    toneMapped: false,
  });
  // A back-face shell frames the ghost even when the solid hand overlaps it.
  const outline = new MeshBasicMaterial({
    color: palette.target,
    side: BackSide,
    transparent: true,
    opacity: GHOST_OPACITY * OUTLINE_RATIO,
    depthWrite: false,
    toneMapped: false,
  });
  const materials = [palm, ...fingers, ghost, outline];
  // A steady high-contrast contour keeps coach focus separate from state color.
  const focusMaterial = new MeshBasicMaterial({
    color: palette.text,
    side: BackSide,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  materials.push(focusMaterial);
  const focusMeshes: Mesh[][] = FINGERS.map(() => []);
  function attach(
    parent: Group,
    geometry: (typeof geometries)[number],
    material: MeshLambertMaterial | MeshBasicMaterial,
    y = 0,
    shell = false,
  ) {
    const mesh = new Mesh(geometry, material);
    mesh.position.y = y;
    // Draw the flat target first. The solid hand must mask its overlapping fill.
    mesh.renderOrder = material instanceof MeshLambertMaterial ? 1 : 0;
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
      const focus = new Mesh(geometry, focusMaterial);
      focus.position.y = length / 2;
      focus.scale.setScalar(1.18);
      focus.renderOrder = 2;
      focus.visible = false;
      actual.fingers[finger].joints[i].add(focus);
      focusMeshes[f].push(focus);
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
    focusMaterial,
    focusMeshes,
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
