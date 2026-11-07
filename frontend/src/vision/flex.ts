import type { FingerId, JointAngles } from '../contracts/vision';
export type Landmark = [number, number, number];
export function jointAngles(
  _landmarks: Landmark[],
): Record<FingerId, JointAngles> {
  throw new Error('WP3');
}
export function normalizeClosure(
  _raw: number,
  _open: number,
  _closed: number,
): number {
  throw new Error('WP3');
}
export function pinchRatio(_landmarks: Landmark[]): number {
  throw new Error('WP3');
}
