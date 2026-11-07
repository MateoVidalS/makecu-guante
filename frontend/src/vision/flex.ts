import type { FingerId, JointAngles } from '../contracts/vision';

export type Landmark = [number, number, number];
export const FINGERS: FingerId[] = [
  'thumb',
  'index',
  'middle',
  'ring',
  'pinky',
];
export const fingerMap = <T>(
  value: (finger: FingerId) => T,
): Record<FingerId, T> =>
  Object.fromEntries(
    FINGERS.map((finger) => [finger, value(finger)]),
  ) as Record<FingerId, T>;

export function validLandmarks(points: Landmark[]): boolean {
  return (
    points.length === 21 &&
    points.every((p) => p.length === 3 && p.every(Number.isFinite))
  );
}
const vector = (a: Landmark, b: Landmark): Landmark => [
  b[0] - a[0],
  b[1] - a[1],
  b[2] - a[2],
];
const length = (v: Landmark) => Math.hypot(...v);
function angle(a: Landmark, b: Landmark): number {
  const denominator = length(a) * length(b);
  if (denominator < 1e-12) throw new Error('Degenerate hand landmarks');
  const cosine = a.reduce((sum, v, i) => sum + v * b[i], 0) / denominator;
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

/** World-space bone vectors; straight fingers have zero flexion. */
export function jointAngles(
  landmarks: Landmark[],
): Record<FingerId, JointAngles> {
  if (!validLandmarks(landmarks))
    throw new Error('Expected 21 finite hand landmarks');
  const bone = (a: number, b: number) => vector(landmarks[a], landmarks[b]);
  return fingerMap((finger) => {
    if (finger === 'thumb')
      return {
        mcp: angle(bone(1, 2), bone(2, 3)),
        pip: angle(bone(2, 3), bone(3, 4)),
        dip: 0,
      };
    const base = { index: 5, middle: 9, ring: 13, pinky: 17 }[finger];
    return {
      mcp: angle(bone(0, base), bone(base, base + 1)),
      pip: angle(bone(base, base + 1), bone(base + 1, base + 2)),
      dip: angle(bone(base + 1, base + 2), bone(base + 2, base + 3)),
    };
  });
}

/** A degenerate calibration must never produce NaN or imply movement. */
export function normalizeClosure(
  raw: number,
  open: number,
  closed: number,
): number {
  if (![raw, open, closed].every(Number.isFinite) || closed - open < 1e-6)
    return 0;
  return Math.max(0, Math.min(1.1, (raw - open) / (closed - open)));
}
export function pinchRatio(landmarks: Landmark[]): number {
  if (!validLandmarks(landmarks))
    throw new Error('Expected 21 finite hand landmarks');
  const handSize = length(vector(landmarks[0], landmarks[9]));
  if (handSize < 1e-12) throw new Error('Degenerate hand size');
  return length(vector(landmarks[4], landmarks[8])) / handSize;
}
