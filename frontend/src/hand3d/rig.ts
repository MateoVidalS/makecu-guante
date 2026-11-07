import type { Group } from 'three';
import type { FingerId, JointAngles } from '../contracts/vision';
import type { PoseDef } from '../contracts/poses';
export type JointMap = Record<FingerId, JointAngles>;
export function applyJoints(_rig: Group, _joints: JointMap): void {
  throw new Error('WP6');
}
export function jointsFromClosure(
  _closure: Record<FingerId, number>,
  _pose?: PoseDef,
): JointMap {
  throw new Error('WP6');
}
