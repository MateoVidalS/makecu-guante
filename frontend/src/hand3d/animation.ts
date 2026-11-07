import { Color } from 'three';
import { tokens } from '../styles/tokens';
import type { FingerId } from '../contracts/vision';
import { applyJoints, FINGERS, type JointMap } from './rig';
import type { createHandScene, FingerState, HandTheme } from './scene';

const REACH_SECONDS = parseFloat(tokens.durReach) / 1000;
/** Owns reusable animation state; tick allocates no vectors, arrays, or objects. */
export function createHandAnimator(
  scene: ReturnType<typeof createHandScene>,
  palette: HandTheme,
) {
  const colors = {
    idle: new Color(palette.hand),
    active: new Color(palette.active),
    assist: new Color(palette.assist),
    reached: new Color(palette.reached),
  };
  const animator = {
    visible: true,
    visibilityChanged: false,
    reached: false,
    pulse: -1,
    rimIntensity: 0,
    resetReach() {
      animator.reached = false;
      animator.pulse = -1;
    },
    tick(
      sample: JointMap | null,
      state: (finger: FingerId) => FingerState,
      hasTarget: boolean,
      reducedMotion: boolean,
      delta: number,
    ) {
      const visible = sample !== null;
      animator.visibilityChanged = visible !== animator.visible;
      animator.visible = visible;
      if (sample) applyJoints(scene.actual, sample, reducedMotion ? 1 : 0.5);
      const opacity = visible ? 1 : 0.3;
      const blend = reducedMotion ? 1 : Math.min(1, delta * 12);
      scene.palm.opacity = reducedMotion
        ? opacity
        : scene.palm.opacity + (opacity - scene.palm.opacity) * blend;
      scene.palm.transparent = scene.palm.opacity < 0.999;
      let reached = false;
      for (let i = 0; i < FINGERS.length; i++) {
        const status = i < 3 ? state(FINGERS[i]) : 'idle';
        const material = scene.fingers[i];
        material.color.copy(colors.idle);
        if (status !== 'idle') material.color.lerp(colors[status], 0.55);
        material.opacity = scene.palm.opacity;
        material.transparent = scene.palm.transparent;
        if (status === 'reached') reached = true;
      }
      if (reached && !animator.reached && visible) animator.pulse = 0;
      animator.reached = reached;
      if (animator.pulse >= 0) animator.pulse += delta;
      const progress =
        animator.pulse < 0 ? 1 : Math.min(1, animator.pulse / REACH_SECONDS);
      animator.rimIntensity =
        !reducedMotion && visible && reached
          ? Math.sin(progress * Math.PI) * 2
          : 0;
      // Reached means HOLD: brighten once, then show the patient alone.
      scene.ghost.opacity = !hasTarget
        ? 0
        : reached && visible
          ? reducedMotion
            ? 0
            : 0.55 * (1 - progress)
          : 0.35;
      scene.outline.opacity = scene.ghost.opacity * 1.5;
      scene.target.visible = scene.ghost.opacity > 0;
    },
  };
  return animator;
}
