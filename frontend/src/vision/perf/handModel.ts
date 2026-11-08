/**
 * Synthetic hand + camera model for the hand-position performance suite.
 *
 * NOT hardware validation: MediaPipe itself is replaced by a forward-kinematic
 * hand projected into the camera, plus a parametric landmark-error model. It
 * measures everything downstream of MediaPipe (joint math, smoothing,
 * calibration, the engine's "reached" rule) under controlled, reproducible
 * error, so regressions and design limits show up as numbers.
 *
 * Hand frame (metres): wrist at the origin, fingers along +y, palm in the
 * xy plane, palmar side (the direction fingers curl to) = +z. Same bone
 * lengths as fixtures/generateFixtures.py.
 */
import type { CameraView } from '../../contracts/calibration';
import { POSES, type PoseId } from '../../contracts/poses';
import type { FingerId, Handedness, JointAngles } from '../../contracts/vision';
import { FINGERS, fingerMap, type Landmark } from '../flex';
import type { HandResult } from '../frameProcessor';

export type HandAngles = Record<FingerId, JointAngles>; // thumb: mcp, ip in pip, dip = 0
type V = [number, number, number];

// ---------- seeded randomness ----------
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// ---------- vectors ----------
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (v: V, s: number): V => [v[0] * s, v[1] * s, v[2] * s];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: V): V => scale(v, 1 / Math.hypot(...v));
const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const lerpV = (a: V, b: V, s: number): V => add(a, scale(sub(b, a), s));
const rad = (deg: number) => (deg * Math.PI) / 180;
type M = [V, V, V]; // rows
const mul = (m: M, v: V): V => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
const mulM = (a: M, b: M): M =>
  a.map((row) =>
    [0, 1, 2].map((j) => dot(row, [b[0][j], b[1][j], b[2][j]])),
  ) as M;
const rotX = (d: number): M => {
  const c = Math.cos(rad(d)),
    s = Math.sin(rad(d));
  return [
    [1, 0, 0],
    [0, c, -s],
    [0, s, c],
  ];
};
const rotY = (d: number): M => {
  const c = Math.cos(rad(d)),
    s = Math.sin(rad(d));
  return [
    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c],
  ];
};
const rotZ = (d: number): M => {
  const c = Math.cos(rad(d)),
    s = Math.sin(rad(d));
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
};

// ---------- hand ----------
const LONG: { base: number; at: [number, number]; lengths: V }[] = [
  { base: 5, at: [-0.028, 0.073], lengths: [0.038, 0.024, 0.018] },
  { base: 9, at: [0.0, 0.08], lengths: [0.044, 0.027, 0.02] },
  { base: 13, at: [0.025, 0.074], lengths: [0.041, 0.025, 0.018] },
  { base: 17, at: [0.045, 0.06], lengths: [0.032, 0.02, 0.016] },
];

/**
 * 21 landmarks in the hand frame. `contact` (0..1) blends the thumb tip onto the
 * index tip like the synthetic pinch fixture (helper-assisted contact).
 */
export function handLandmarks(
  angles: HandAngles,
  { size = 1, contact = 0 }: { size?: number; contact?: number } = {},
): V[] {
  const p: V[] = Array.from({ length: 21 }, () => [0, 0, 0] as V);
  const chain = (start: number, dir: V, flex: number[], lengths: number[]) => {
    let cumulative = 0;
    flex.forEach((angle, k) => {
      cumulative += rad(angle);
      const bone = add(scale(dir, Math.cos(cumulative)), [
        0,
        0,
        Math.sin(cumulative),
      ]);
      p[start + k + 1] = add(p[start + k], scale(bone, lengths[k]));
    });
  };
  p[1] = [-0.035, 0.025, 0];
  const thumbDir = unit([-1, 1, 0]);
  p[2] = add(p[1], scale(thumbDir, 0.028));
  chain(2, thumbDir, [angles.thumb.mcp, angles.thumb.pip], [0.028, 0.022]);
  const names: FingerId[] = ['index', 'middle', 'ring', 'pinky'];
  LONG.forEach(({ base, at, lengths }, i) => {
    p[base] = [at[0], at[1], 0];
    const a = angles[names[i]];
    chain(base, unit(p[base]), [a.mcp, a.pip, a.dip], lengths);
  });
  if (contact > 0) {
    const target = add(p[8], [0.001, 0, 0]);
    const knuckle = add(lerpV(p[2], target, 0.6), [0, 0, -0.008]);
    p[3] = lerpV(p[3], knuckle, contact);
    p[4] = lerpV(p[4], target, contact);
  }
  return p.map((v) => scale(v, size));
}

export const sumOf = (a: JointAngles) => a.mcp + a.pip + a.dip;
export const flexSums = (angles: HandAngles) =>
  fingerMap((f) => sumOf(angles[f]));

// ---------- patients ----------
export interface Patient {
  name: string;
  /** Relaxed open hand (calibration open_flex). */
  open: HandAngles;
  /** Relaxed hand closed as far as the glove goes (calibration closed_flex). */
  closed: HandAngles;
  size: number;
}
const uniform = (
  mcp: number,
  pip: number,
  dip: number,
  thumb: [number, number],
): HandAngles =>
  fingerMap((f) =>
    f === 'thumb'
      ? { mcp: thumb[0], pip: thumb[1], dip: 0 }
      : { mcp, pip, dip },
  );
const FIST = POSES.full_fist.render;
const scaleAngles = (a: HandAngles, s: number): HandAngles =>
  fingerMap((f) => ({
    mcp: a[f].mcp * s,
    pip: a[f].pip * s,
    dip: a[f].dip * s,
  }));

export const PATIENTS: Record<'healthy' | 'spastic', Patient> = {
  healthy: {
    name: 'full range',
    open: uniform(0, 0, 0, [0, 0]),
    closed: FIST,
    size: 1,
  },
  // Post-stroke flexor tone: never fully open; the glove reaches ~70% of a fist (12-five-finger H6).
  spastic: {
    name: 'resting flexion, glove-limited close',
    open: uniform(15, 25, 10, [15, 10]),
    closed: scaleAngles(FIST, 0.7),
    size: 0.9,
  },
};

/** The pose as this patient performs it: each joint at the same fraction of its own range as the target render. */
export function performed(
  patient: Patient,
  pose: PoseId,
  effort = 1,
): HandAngles {
  const render = POSES[pose].render;
  return fingerMap((f) => {
    const joint = (k: keyof JointAngles) => {
      const range = patient.closed[f][k] - patient.open[f][k];
      const fraction = FIST[f][k] > 0 ? render[f][k] / FIST[f][k] : 0;
      return patient.open[f][k] + fraction * range * effort;
    };
    return {
      mcp: joint('mcp'),
      pip: joint('pip'),
      dip: f === 'thumb' ? 0 : joint('dip'),
    };
  });
}
/** Every finger at an exact true closure fraction of this patient's calibrated range. */
export function atClosure(
  patient: Patient,
  closure: Record<FingerId, number>,
): HandAngles {
  return fingerMap((f) => {
    const j = (k: keyof JointAngles) =>
      patient.open[f][k] +
      closure[f] * (patient.closed[f][k] - patient.open[f][k]);
    return { mcp: j('mcp'), pip: j('pip'), dip: f === 'thumb' ? 0 : j('dip') };
  });
}
/**
 * The pose's own shape, rescaled per finger so each finger lands on `desired` closure
 * (null = keep the performed shape). Used to place fingers exactly at/around targets.
 */
export function shaped(
  patient: Patient,
  pose: PoseId,
  desired: Partial<Record<FingerId, number | null>>,
): HandAngles {
  const base = performed(patient, pose);
  const now = trueClosure(patient, base);
  return fingerMap((f) => {
    const want = desired[f];
    if (want === null || want === undefined) return base[f];
    if (Math.abs(now[f]) < 1e-6)
      return atClosure(
        patient,
        fingerMap(() => want),
      )[f];
    const k = want / now[f];
    const j = (key: keyof JointAngles) =>
      patient.open[f][key] + k * (base[f][key] - patient.open[f][key]);
    return { mcp: j('mcp'), pip: j('pip'), dip: f === 'thumb' ? 0 : j('dip') };
  });
}
export function trueClosure(
  patient: Patient,
  angles: HandAngles,
): Record<FingerId, number> {
  const open = flexSums(patient.open),
    closed = flexSums(patient.closed),
    now = flexSums(angles);
  return fingerMap((f) => (now[f] - open[f]) / (closed[f] - open[f]));
}

// ---------- camera views ----------
export interface Tilt {
  yaw?: number; // degrees, about the camera's vertical axis
  pitch?: number; // about the camera's horizontal axis (hand leaning back/forward)
  roll?: number; // in the image plane
}
const F = 480; // focal length in pixels for a 640x480 frame (~67° horizontal FOV)

interface Placement {
  rotation: M; // hand frame -> camera frame (x right, y down, z away from the camera)
  wrist: V; // wrist position in the camera frame (metres)
}
function placement(view: CameraView, tilt: Tilt): Placement {
  const extra = mulM(
    rotZ(tilt.roll ?? 0),
    mulM(rotY(tilt.yaw ?? 0), rotX(tilt.pitch ?? 0)),
  );
  if (view === 'front_upright') {
    // Hand raised beside the face, palm to the laptop webcam: fingers up (-y), curling toward the lens (-z).
    const base: M = [
      [1, 0, 0],
      [0, -1, 0],
      [0, 0, -1],
    ];
    return { rotation: mulM(extra, base), wrist: [0.06, 0.1, 0.5] };
  }
  // Legacy palm-down setup: same camera as fixtures/generateFixtures.py (36 cm, thumb side, above).
  const target: V = [0, 0.065, 0];
  const position = add(target, scale(unit([-0.55, 0.65, -0.52]), 0.36));
  const forward = unit(sub(target, position));
  const right = unit(cross(forward, [0, 0, -1]));
  const up = cross(right, forward);
  const base: M = [right, scale(up, -1), forward];
  return {
    rotation: mulM(extra, base),
    wrist: mul(base, sub([0, 0, 0], position)),
  };
}

// ---------- MediaPipe error model ----------
export interface NoiseModel {
  label: string;
  /** Per-landmark Gaussian error of world landmarks in the image plane (mm). */
  worldXyMm: number;
  /** Per-landmark Gaussian error along the camera depth axis (mm); MediaPipe's weakest axis. */
  worldZMm: number;
  /** Systematic depth flattening of the predicted hand (1 = none; 0.7 = 30% flatter). */
  depthScale: number;
  /** Image landmark error (pixels in a 640x480 frame). */
  imagePx: number;
}
/**
 * Error levels. `bench` reproduces the per-finger raw flex-sum jitter that the real
 * MediaPipe model showed on the rendered hand (mediapipe-bench.result.json: ~1.2 mm
 * xy / 2.2 mm z correlated landmark jitter, 2.5-12 deg raw flex-sum std). Independent
 * per-landmark noise needs smaller sigmas to give the same angle jitter. `glove` and
 * `severe` are 2x and 3.5x that, for a gloved hand, poor light or a far camera.
 */
export const NOISE: Record<'ideal' | 'bench' | 'glove' | 'severe', NoiseModel> =
  {
    ideal: {
      label: 'ideal',
      worldXyMm: 0,
      worldZMm: 0,
      depthScale: 1,
      imagePx: 0,
    },
    bench: {
      label: 'bench (1x)',
      worldXyMm: 0.6,
      worldZMm: 1.2,
      depthScale: 1,
      imagePx: 1,
    },
    glove: {
      label: 'glove (2x)',
      worldXyMm: 1.2,
      worldZMm: 2.4,
      depthScale: 1,
      imagePx: 2,
    },
    severe: {
      label: 'severe (3.5x)',
      worldXyMm: 2.1,
      worldZMm: 4.2,
      depthScale: 1,
      imagePx: 3,
    },
  };
export const withNoise = (
  base: NoiseModel,
  change: Partial<NoiseModel>,
): NoiseModel => ({
  ...base,
  ...change,
});

export interface Scene {
  view: CameraView;
  hand: Handedness;
  noise: NoiseModel;
  tilt?: Tilt;
  score?: number; // MediaPipe handedness score
}
export const EMPTY_RESULT: HandResult = {
  landmarks: [],
  worldLandmarks: [],
  handedness: [],
};

/** What MediaPipe would report for this hand in this scene (one hand in view). */
export function observe(
  points: V[],
  scene: Scene,
  rand: () => number = rng(1),
): HandResult {
  const { rotation, wrist } = placement(scene.view, scene.tilt ?? {});
  // A left hand is the mirror image of the modelled right hand.
  const mirrored = points.map(([x, y, z]): V => [
    scene.hand === 'left' ? -x : x,
    y,
    z,
  ]);
  const cam = mirrored.map((p) => add(mul(rotation, p), wrist));
  const centroid = scale(cam.reduce(add, [0, 0, 0] as V), 1 / cam.length);
  const n = scene.noise;
  const world = cam.map((p): Landmark => {
    const r = sub(p, centroid);
    return [
      r[0] + (gaussian(rand) * n.worldXyMm) / 1000,
      r[1] + (gaussian(rand) * n.worldXyMm) / 1000,
      r[2] * n.depthScale + (gaussian(rand) * n.worldZMm) / 1000,
    ];
  });
  const wristDepth = cam[0][2];
  const image = cam.map((p): Landmark => [
    0.5 + (F * p[0]) / p[2] / 640 + (gaussian(rand) * n.imagePx) / 640,
    0.5 + (F * p[1]) / p[2] / 480 + (gaussian(rand) * n.imagePx) / 480,
    ((p[2] - wristDepth) * F) / wristDepth / 640,
  ]);
  const toPoints = (list: Landmark[]) =>
    list.map(([x, y, z]) => ({ x, y, z, visibility: 1 }));
  return {
    landmarks: [toPoints(image)],
    worldLandmarks: [toPoints(world)],
    handedness: [
      [
        {
          categoryName: scene.hand === 'left' ? 'Left' : 'Right',
          score: scene.score ?? 0.95,
          index: 0,
          displayName: '',
        },
      ],
    ],
  };
}

/** Noise-free thumb-index pinch ratio as the pipeline defines it (image space). */
export function truePinch(points: V[], scene: Scene): number {
  const r = observe(points, { ...scene, noise: NOISE.ideal });
  const lm = r.landmarks[0];
  const d = (a: number, b: number) =>
    Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y, lm[a].z - lm[b].z);
  return d(4, 8) / d(0, 9);
}

// ---------- motion ----------
export interface Keyframe {
  at: number; // ms
  angles: HandAngles;
  contact?: number;
}
/** Minimum-jerk interpolation between keyframes (smooth, human-like reaches). */
export function poseAt(
  keys: Keyframe[],
  t: number,
): { angles: HandAngles; contact: number } {
  if (t <= keys[0].at)
    return { angles: keys[0].angles, contact: keys[0].contact ?? 0 };
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1],
      b = keys[i];
    if (t <= b.at) {
      const x = b.at === a.at ? 1 : (t - a.at) / (b.at - a.at);
      const s = x * x * x * (10 - 15 * x + 6 * x * x);
      const mix = (u: number, v: number) => u + (v - u) * s;
      return {
        angles: fingerMap((f) => ({
          mcp: mix(a.angles[f].mcp, b.angles[f].mcp),
          pip: mix(a.angles[f].pip, b.angles[f].pip),
          dip: mix(a.angles[f].dip, b.angles[f].dip),
        })),
        contact: mix(a.contact ?? 0, b.contact ?? 0),
      };
    }
  }
  const last = keys.at(-1)!;
  return { angles: last.angles, contact: last.contact ?? 0 };
}

export { FINGERS };
