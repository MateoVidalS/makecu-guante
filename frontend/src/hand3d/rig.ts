import { Group, Quaternion, Vector3 } from 'three';
import type { FingerId, Handedness, JointAngles } from '../contracts/vision';
import type { PoseDef } from '../contracts/poses';

export type JointMap = Record<FingerId, JointAngles>;
export const FINGERS: readonly FingerId[] = [
  'thumb',
  'index',
  'middle',
  'ring',
  'pinky',
];
export const JOINTS = ['mcp', 'pip', 'dip'] as const;

// Model units; +Y is distal, +Z is the palm side. Lengths exclude joint caps.
export const HAND_PROPORTIONS = {
  palm: [1.9, 1.95, 0.42] as const,
  thumb: {
    base: [-0.9, 0.2, 0.2],
    lengths: [0.7, 0.7, 0.55],
    radius: 0.19,
    spread: 0.65,
  },
  index: {
    base: [-0.64, 0.92, 0],
    lengths: [0.9, 0.59, 0.45],
    radius: 0.17,
    spread: 0.06,
  },
  middle: {
    base: [-0.21, 0.98, 0],
    lengths: [1.02, 0.66, 0.48],
    radius: 0.18,
    spread: 0,
  },
  ring: {
    base: [0.24, 0.94, 0],
    lengths: [0.94, 0.62, 0.46],
    radius: 0.17,
    spread: -0.04,
  },
  pinky: {
    base: [0.65, 0.78, 0],
    lengths: [0.72, 0.46, 0.38],
    radius: 0.145,
    spread: -0.13,
  },
} as const;

export interface FingerRig {
  base: Group;
  joints: [Group, Group, Group];
  tip: Group;
  desired: [Quaternion, Quaternion, Quaternion];
}
export interface HandRig extends Group {
  fingers: Record<FingerId, FingerRig>;
}
const FLEX_AXIS = new Vector3(1, 0, 0);
const DEG = Math.PI / 180;
const finiteClamp = (value: number, max: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;

/** Build transforms only; rendering can attach meshes without changing joint math. */
export function createHandRig(handedness: Handedness = 'right'): HandRig {
  const rig = new Group() as HandRig;
  rig.name = `${handedness}-hand`;
  rig.scale.x = handedness === 'left' ? -1 : 1;
  rig.fingers = {} as Record<FingerId, FingerRig>;
  for (const finger of FINGERS) {
    const dimensions = HAND_PROPORTIONS[finger];
    const base = new Group();
    base.position.set(
      dimensions.base[0],
      dimensions.base[1],
      dimensions.base[2],
    );
    base.rotation.z = dimensions.spread;
    const joints: FingerRig['joints'] = [new Group(), new Group(), new Group()];
    const tip = new Group();
    base.add(joints[0]);
    for (let i = 0; i < 2; i++) {
      joints[i + 1].position.y = dimensions.lengths[i];
      joints[i].add(joints[i + 1]);
    }
    tip.position.y = dimensions.lengths[2];
    joints[2].add(tip);
    rig.add(base);
    rig.fingers[finger] = {
      base,
      joints,
      tip,
      desired: [new Quaternion(), new Quaternion(), new Quaternion()],
    };
  }
  return rig;
}

/** Reuses scratch quaternions. alpha=0.5 smooths a live sample without React renders. */
export function applyJoints(rig: HandRig, joints: JointMap, alpha = 1): void {
  for (const finger of FINGERS) {
    const chain = rig.fingers[finger];
    for (let i = 0; i < 3; i++) {
      // Thumb: metacarpal opposition, MCP, IP (the latter lives in pip).
      const source =
        finger === 'thumb'
          ? i === 0
            ? joints.thumb.mcp * 1.2
            : i === 1
              ? joints.thumb.mcp
              : joints.thumb.pip
          : joints[finger][JOINTS[i]];
      const degrees = finiteClamp(source, i === 0 ? 100 : 120);
      chain.desired[i].setFromAxisAngle(FLEX_AXIS, degrees * DEG);
      chain.joints[i].quaternion.slerp(chain.desired[i], alpha);
    }
    if (finger === 'thumb') {
      const opposition = finiteClamp(joints.thumb.mcp, 100) * DEG;
      chain.base.rotation.z +=
        (HAND_PROPORTIONS.thumb.spread -
          opposition * 1.5 -
          chain.base.rotation.z) *
        alpha;
    }
  }
}

/** Closure is a scalar estimate, not a per-joint measurement. Pose shape is a hint. */
export function jointsFromClosure(
  closure: Record<FingerId, number>,
  pose?: PoseDef,
): JointMap {
  const result = {} as JointMap;
  for (const finger of FINGERS) {
    const amount = finiteClamp(closure[finger], 1);
    const target = pose?.closure[finger];
    const shape =
      pose && target != null && target > 0 ? pose.render[finger] : undefined;
    const ratio = shape ? amount / target! : amount;
    const full =
      finger === 'thumb'
        ? { mcp: 50, pip: 50, dip: 0 }
        : { mcp: 90, pip: 100, dip: 80 };
    result[finger] = {
      mcp: finiteClamp((shape ?? full).mcp * ratio, 100),
      pip: finiteClamp((shape ?? full).pip * ratio, 120),
      dip:
        finger === 'thumb' ? 0 : finiteClamp((shape ?? full).dip * ratio, 120),
    };
  }
  return result;
}
