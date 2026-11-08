import { Color } from 'three';
import { tokens } from '../styles/tokens';
import type { FingerId } from '../contracts/vision';
import { applyJoints, FINGERS, type JointMap } from './rig';
import {
  GHOST_OPACITY,
  OUTLINE_RATIO,
  STATE_TINT,
  type createHandScene,
  type FingerState,
  type HandTheme,
} from './scene';
import { createJointSmoother } from './smoothing';

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
    stopped: new Color(palette.caution),
  };
  const smoother = createJointSmoother();
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
      keepTargetOnReach = false,
      highlight: FingerId | null = null,
    ) {
      const visible = sample !== null;
      animator.visibilityChanged = visible !== animator.visible;
      animator.visible = visible;
      if (sample)
        applyJoints(
          scene.actual,
          smoother.step(sample, delta, reducedMotion),
          1,
        );
      const opacity = visible ? 1 : 0.3;
      const blend = reducedMotion ? 1 : Math.min(1, delta * 12);
      scene.palm.opacity = reducedMotion
        ? opacity
        : scene.palm.opacity + (opacity - scene.palm.opacity) * blend;
      // Keep one transparent render pass, even at full opacity, so the actual
      // hand draws after the ghost and retains its clay/state color.
      scene.palm.transparent = true;
      scene.focusMaterial.opacity = scene.palm.opacity;
      let reached = false;
      let pending = false;
      for (let i = 0; i < FINGERS.length; i++) {
        const status = state(FINGERS[i]);
        const material = scene.fingers[i];
        const highlighted = highlight === FINGERS[i];
        for (let segment = 0; segment < 3; segment++)
          scene.focusMeshes[i][segment].visible = highlighted;
        material.color.copy(colors.idle);
        if (status !== 'idle')
          material.color.lerp(colors[status], highlighted ? 1 : STATE_TINT);
        material.opacity = scene.palm.opacity;
        material.transparent = scene.palm.transparent;
        if (status === 'reached') reached = true;
        // A finger the glove stopped for is not reached: no success pulse.
        if (status === 'active' || status === 'assist' || status === 'stopped')
          pending = true;
      }
      reached &&= !pending;
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
        : reached && visible && !keepTargetOnReach
          ? reducedMotion
            ? 0
            : GHOST_OPACITY * 1.5 * (1 - progress)
          : GHOST_OPACITY;
      scene.outline.opacity = scene.ghost.opacity * OUTLINE_RATIO;
      scene.target.visible = scene.ghost.opacity > 0;
    },
  };
  return animator;
}
