import { FINGERS, JOINTS, type JointMap } from './rig';

/**
 * Render-side damping for the live hand. Samples arrive at camera rate (~30 Hz)
 * while the scene renders at display rate, so a fixed per-frame blend both
 * staircases and changes speed with the frame rate. Instead:
 * - a dead-band holds the target until it moves by more than DEAD_BAND degrees,
 *   so residual sub-degree noise never reaches the mesh;
 * - the rendered angle approaches the held target with 1 - exp(-dt * k),
 *   which is the same motion at 30, 60 or 120 fps.
 */
export const HAND_DAMPING = { rate: 28, deadBand: 1 };

export interface JointSmoother {
  /** Current rendered angles (mutated in place, never reallocated). */
  readonly value: JointMap;
  /** Advance by `delta` seconds towards `sample`; `snap` jumps straight there. */
  step(sample: JointMap, delta: number, snap?: boolean): JointMap;
}

const blank = (): JointMap => ({
  thumb: { mcp: 0, pip: 0, dip: 0 },
  index: { mcp: 0, pip: 0, dip: 0 },
  middle: { mcp: 0, pip: 0, dip: 0 },
  ring: { mcp: 0, pip: 0, dip: 0 },
  pinky: { mcp: 0, pip: 0, dip: 0 },
});

export function createJointSmoother(
  rate = HAND_DAMPING.rate,
  deadBand = HAND_DAMPING.deadBand,
): JointSmoother {
  const held = blank(),
    value = blank();
  let primed = false;
  return {
    value,
    step(sample, delta, snap = false) {
      const blend =
        snap || !primed
          ? 1
          : 1 -
            Math.exp(-Math.max(0, Number.isFinite(delta) ? delta : 0) * rate);
      for (let f = 0; f < FINGERS.length; f++) {
        const finger = FINGERS[f];
        for (let j = 0; j < JOINTS.length; j++) {
          const joint = JOINTS[j];
          const next = sample[finger][joint];
          if (!Number.isFinite(next)) continue;
          if (
            !primed ||
            snap ||
            Math.abs(next - held[finger][joint]) > deadBand
          )
            held[finger][joint] = next;
          value[finger][joint] +=
            (held[finger][joint] - value[finger][joint]) * blend;
        }
      }
      primed = true;
      return value;
    },
  };
}
