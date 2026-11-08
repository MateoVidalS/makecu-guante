/**
 * Drives the production pipeline (FrameProcessor -> captureStats -> ExerciseEngine)
 * with the synthetic hand from handModel.ts. Nothing here re-implements the
 * production rules: closure, calibration and "reached" all come from the real code.
 */
import calibrationFixture from '../../../../contracts/fixtures/calibration.json';
import {
  CURRENT_FLEX_MODEL,
  type Calibration,
  type CameraCalibration,
} from '../../contracts/calibration';
import type { EngineEvent } from '../../contracts/engine';
import type { GloveTelemetry } from '../../contracts/glove';
import {
  calibratedPinch,
  DEFAULT_EXERCISE_SETTINGS,
  POSES,
  type PoseId,
} from '../../contracts/poses';
import type { FingerId, VisionFrame } from '../../contracts/vision';
import { createExerciseEngine } from '../../engine';
import { captureStats } from '../calibration';
import { FINGERS, fingerMap } from '../flex';
import { FrameProcessor, type HandResult } from '../frameProcessor';
import {
  EMPTY_RESULT,
  handLandmarks,
  observe,
  poseAt,
  rng,
  truePinch,
  type HandAngles,
  type Keyframe,
  type Patient,
  type Scene,
} from './handModel';

export interface Sample {
  t: number;
  result: HandResult;
  truth: { closure: Record<FingerId, number>; pinch: number };
}
export interface StreamOptions {
  fps?: number;
  /** Independent per-frame detection miss probability. */
  dropRate?: number;
  /** Frame timing jitter, ms (uniform ±). */
  jitterMs?: number;
  seed?: number;
  /** Also compute the noise-free pinch ratio (costs a second projection per frame). */
  pinchTruth?: boolean;
}

/** Camera frames of a patient following keyframes, as MediaPipe results + ground truth. */
export function stream(
  patient: Patient,
  scene: Scene,
  keys: Keyframe[],
  durationMs: number,
  {
    fps = 30,
    dropRate = 0,
    jitterMs = 0,
    seed = 1,
    pinchTruth = false,
  }: StreamOptions = {},
): Sample[] {
  const rand = rng(seed);
  const samples: Sample[] = [];
  // Independent oracle on exact geometry: never call production jointAngles.
  // Contact changes the actual thumb shape, so measure its exact bone angles.
  const geometrySums = (angles: HandAngles, contact = 0) => {
    const points = handLandmarks(angles, { size: patient.size, contact });
    const bone = (a: number, b: number) =>
      points[b].map((v, k) => v - points[a][k]);
    const angle = (a: number[], b: number[]) => {
      const cosine =
        a.reduce((sum, v, k) => sum + v * b[k], 0) /
        (Math.hypot(...a) * Math.hypot(...b));
      return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
    };
    return fingerMap((finger) => {
      if (finger === 'thumb')
        return angle(bone(1, 2), bone(2, 3)) + angle(bone(2, 3), bone(3, 4));
      const base = { index: 5, middle: 9, ring: 13, pinky: 17 }[finger];
      return (
        angle(bone(0, base), bone(base, base + 1)) +
        angle(bone(base, base + 1), bone(base + 1, base + 2)) +
        angle(bone(base + 1, base + 2), bone(base + 2, base + 3))
      );
    });
  };
  const open = geometrySums(patient.open),
    closed = geometrySums(patient.closed);
  const period = 1000 / fps;
  let last = -Infinity;
  for (let i = 0; i * period <= durationMs; i++) {
    const t = Math.max(last + 1, i * period + (rand() - 0.5) * 2 * jitterMs);
    last = t;
    const { angles, contact } = poseAt(keys, t);
    const points = handLandmarks(angles, { size: patient.size, contact });
    samples.push({
      t,
      result: rand() < dropRate ? EMPTY_RESULT : observe(points, scene, rand),
      truth: {
        closure: (() => {
          const now = geometrySums(angles, contact);
          return fingerMap((f) => (now[f] - open[f]) / (closed[f] - open[f]));
        })(),
        pinch: pinchTruth ? truePinch(points, scene) : NaN,
      },
    });
  }
  return samples;
}
export const hold = (angles: HandAngles, contact = 0): Keyframe[] => [
  { at: 0, angles, contact },
];

export function runVision(
  samples: Sample[],
  scene: Scene,
  camera: CameraCalibration | null,
): VisionFrame[] {
  const processor = new FrameProcessor();
  processor.calibration = camera;
  return samples.map((s) =>
    processor.process(s.result, s.t, scene.hand, false, scene.view),
  );
}

/** Calibration exactly as the Calibrate page measures it (captureStats over 2 s holds). */
export function calibrate(
  patient: Patient,
  scene: Scene,
  seed = 1,
): { camera: CameraCalibration } | { error: string } {
  const capture = (angles: HandAngles, contact: number, s: number) =>
    captureStats(
      runVision(
        stream(patient, scene, hold(angles, contact), 3000, { seed: s }),
        scene,
        null,
      ),
      2,
    );
  try {
    const open = capture(patient.open, 0, seed);
    const closed = capture(patient.closed, 0, seed + 101);
    const pinchPose = POSES.pinch.render;
    const pinch = capture(
      { ...patient.open, thumb: pinchPose.thumb, index: pinchPose.index },
      1,
      seed + 202,
    );
    return {
      camera: {
        affected_hand: scene.hand,
        camera_view: scene.view,
        flex_model: CURRENT_FLEX_MODEL,
        open_flex: open.rawFlexSum,
        closed_flex: closed.rawFlexSum,
        pinch_open: open.pinch,
        pinch_closed: pinch.pinch,
      },
    };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
export function mustCalibrate(
  patient: Patient,
  scene: Scene,
  seed = 1,
): CameraCalibration {
  const result = calibrate(patient, scene, seed);
  if ('error' in result) throw new Error(`calibration failed: ${result.error}`);
  return result.camera;
}

/** The engine's reach rule evaluated on ground truth (what a perfect camera would report). */
export function truthSatisfies(
  pose: PoseId,
  sample: Sample,
  pinchClosed: number,
  tolerance = DEFAULT_EXERCISE_SETTINGS.tolerance,
): boolean {
  const def = pose === 'pinch' ? calibratedPinch(pinchClosed) : POSES[pose];
  const fingers = FINGERS.every((f) => {
    const target = def.closure[f];
    if (target === null) return true;
    const value = Math.min(1, Math.max(0, sample.truth.closure[f]));
    return pose === 'open'
      ? value <= target + tolerance
      : value >= target - tolerance;
  });
  return fingers && (!def.pinch || sample.truth.pinch <= def.pinch.max_ratio);
}

export interface AckResult {
  /** Engine time of the `reached` event (ms), null if never acknowledged. */
  reachedAt: number | null;
  attemptAt: number | null;
  /** First time the true hand satisfied the rule and kept satisfying it until the end. */
  truthAt: number | null;
  phases: string[];
}
const idleTel = (now: number): GloveTelemetry => ({
  t: now,
  ms: now,
  a: [0, 0, 0, 0, 0],
  ma: 80,
  st: 'idle',
  md: 'none',
  tg: [0, 0, 0, 0, 0],
});

/**
 * Runs one observation-only attempt (no glove help) through the real ExerciseEngine,
 * ticking at `tickMs` with the newest camera frame like the runtime does.
 */
export function acknowledge(
  pose: PoseId,
  samples: Sample[],
  frames: VisionFrame[],
  camera: CameraCalibration,
  { tickMs = 20, attempt_s = DEFAULT_EXERCISE_SETTINGS.attempt_s } = {},
): AckResult {
  const engine = createExerciseEngine();
  const calibration: Calibration = {
    ...(calibrationFixture as Calibration),
    camera,
  };
  const t0 = frames[0].t;
  engine.start(
    [{ pose, reps: 1 }],
    {
      ...DEFAULT_EXERCISE_SETTINGS,
      present_s: 0,
      assist_enabled: false,
      attempt_s,
    },
    calibration,
    t0,
  );
  const phases: string[] = [];
  let reachedAt: number | null = null,
    attemptAt: number | null = null,
    k = 0;
  const end = frames.at(-1)!.t;
  for (let now = t0; now <= end && reachedAt === null; now += tickMs) {
    while (k + 1 < frames.length && frames[k + 1].t <= now) k++;
    const out = engine.tick({
      now,
      vision: frames[k],
      tel: idleTel(now),
      gloveEvents: [],
      gloveConnected: true,
    });
    for (const e of out.events as EngineEvent[]) {
      if (e.kind === 'phase') {
        phases.push(e.phase);
        if (e.phase === 'ATTEMPT') attemptAt = now;
      }
      if (e.kind === 'reached') reachedAt = now;
    }
  }
  let truthAt: number | null = null;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (!truthSatisfies(pose, samples[i], camera.pinch_closed)) break;
    truthAt = samples[i].t;
  }
  return { reachedAt, attemptAt, truthAt, phases };
}

// ---------- statistics ----------
export const mean = (v: number[]) =>
  v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
export const std = (v: number[]) => {
  const m = mean(v);
  return Math.sqrt(mean(v.map((x) => (x - m) ** 2)));
};
export function percentile(v: number[], p: number): number {
  if (!v.length) return NaN;
  const sorted = [...v].sort((a, b) => a - b);
  const i = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[i];
}
export const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

/** Print tables only when asked: `pnpm test:vision-perf` (vitest --mode perf) or VISION_PERF_REPORT=1. */
export function report(title: string, rows: Record<string, unknown>[]): void {
  if (import.meta.env.MODE !== 'perf' && !process.env.VISION_PERF_REPORT)
    return;
  console.log(`\n### ${title}`);
  console.table(rows);
}
