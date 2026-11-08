import { CURRENT_CAMERA_VIEW, type CameraView } from '../contracts/calibration';
import type { FingerId, Handedness, JointAngles } from '../contracts/vision';

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
const dot = (a: Landmark, b: Landmark) =>
  a.reduce((sum, value, i) => sum + value * b[i], 0);
const unit = (v: Landmark): Landmark => {
  const magnitude = length(v);
  if (magnitude < 1e-12) throw new Error('Degenerate hand landmarks');
  return v.map((value) => value / magnitude) as Landmark;
};

/** Signed rotation in a flexion plane; retain hyperextension until normalization. */
function signedAngle(a: Landmark, b: Landmark, axis: Landmark): number {
  unit(a);
  unit(b);
  return (Math.atan2(dot(cross(a, b), axis), dot(a, b)) * 180) / Math.PI;
}

const cross = (a: Landmark, b: Landmark): Landmark => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Area normal of the MCP arch, independent of wrist position and camera axes. */
function palmNormal(points: Landmark[]): Landmark {
  const knuckles = [5, 9, 13, 17].map((i) => points[i]);
  const origin = knuckles[0];
  const normal: Landmark = [0, 0, 0];
  for (let i = 1; i < knuckles.length - 1; i++) {
    const triangle = cross(
      vector(origin, knuckles[i]),
      vector(origin, knuckles[i + 1]),
    );
    for (let axis = 0; axis < 3; axis++) normal[axis] += triangle[axis];
  }
  if (length(normal) < 1e-12) throw new Error('Degenerate palm plane');
  return normal;
}

/** World-space flexion; upright MCP is the proximal bone's angle to the palm plane.
 * Axes point toward palmar flexion for the configured hand, independently of labels.
 */
export function jointAngles(
  landmarks: Landmark[],
  view: CameraView = CURRENT_CAMERA_VIEW,
  hand: Handedness = 'right',
): Record<FingerId, JointAngles> {
  if (!validLandmarks(landmarks))
    throw new Error('Expected 21 finite hand landmarks');
  const bone = (a: number, b: number) => vector(landmarks[a], landmarks[b]);
  // For an anatomical right hand, distal x palmar points to the thumb side.
  // The MCP arch's area normal is palmar on right hands and dorsal on left.
  // Use the configured hand, never the detector label, to orient long flexion.
  const normal = unit(palmNormal(landmarks)).map(
    (value) => value * (hand === 'right' ? 1 : -1),
  ) as Landmark;
  const flexionAxis = (reference: Landmark) => unit(cross(reference, normal));
  const forward = cross(normal, bone(5, 17)).map(
    (value) => value * (hand === 'right' ? -1 : 1),
  ) as Landmark;
  return fingerMap((finger) => {
    if (finger === 'thumb') {
      // Full 3D bend, signed by where it points: real thumbs flex partly palmar and
      // partly across the palm, so the reference is palmar normal + the ulnar
      // direction toward the pinky MCP. A bend along it is flexion; away from it is
      // extension. (Signing by the across-palm component alone flips on real
      // MediaPipe output because that component is small for a mostly palmar bend.)
      const ulnar = unit(bone(2, 17));
      const reference: Landmark = [
        normal[0] + ulnar[0],
        normal[1] + ulnar[1],
        normal[2] + ulnar[2],
      ];
      const thumbAngle = (a: Landmark, b: Landmark) => {
        unit(a);
        unit(b);
        const turn = cross(a, b);
        const sign = dot(turn, cross(a, reference)) < 0 ? -1 : 1;
        return (Math.atan2(sign * length(turn), dot(a, b)) * 180) / Math.PI;
      };
      return {
        mcp: thumbAngle(bone(1, 2), bone(2, 3)),
        pip: thumbAngle(bone(2, 3), bone(3, 4)),
        dip: 0,
      };
    }
    const base = { index: 5, middle: 9, ring: 13, pinky: 17 }[finger];
    const axis = flexionAxis(bone(0, base));
    const proximal = bone(base, base + 1);
    return {
      // Keep the palm-plane elevation, including splay invariance. Give its
      // in-plane component a forward/backward sign so noise at a 90° MCP can
      // land on either side of 90°, rather than rectifying downward at a fist.
      mcp:
        view === 'front_upright'
          ? (Math.atan2(
              dot(normal, proximal),
              length(cross(normal, proximal)) *
                (dot(forward, proximal) < 0 ? -1 : 1),
            ) *
              180) /
            Math.PI
          : signedAngle(bone(0, base), proximal, axis),
      pip: signedAngle(proximal, bone(base + 1, base + 2), axis),
      dip: signedAngle(
        bone(base + 1, base + 2),
        bone(base + 2, base + 3),
        axis,
      ),
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
