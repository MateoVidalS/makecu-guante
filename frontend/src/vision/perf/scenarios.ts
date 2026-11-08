/** Shared attempt scenarios for the acknowledgment and timing suites. */
import type { CameraCalibration } from '../../contracts/calibration';
import { POSES, type PoseId } from '../../contracts/poses';
import {
  performed,
  shaped,
  type HandAngles,
  type Keyframe,
  type Patient,
  type Scene,
} from './handModel';
import {
  acknowledge,
  mustCalibrate,
  percentile,
  round,
  runVision,
  stream,
  type AckResult,
  type StreamOptions,
} from './harness';

export const SEEDS = Array.from({ length: 8 }, (_, i) => i + 1);

/** Rest at the start posture for 1 s, then a smooth 1.5 s reach, then hold. */
export function reach(
  patient: Patient,
  pose: PoseId,
  goal?: HandAngles,
): Keyframe[] {
  const start = pose === 'open' ? patient.closed : patient.open;
  // Pinch: the on-screen render misses its own index target (see the known-gap test), so
  // place the scored fingers on their targets; the other poses are performed as rendered.
  const target =
    goal ??
    (pose === 'pinch'
      ? shaped(patient, pose, {
          thumb: POSES.pinch.closure.thumb,
          index: POSES.pinch.closure.index,
        })
      : performed(patient, pose));
  if (pose === 'pinch')
    return [
      { at: 0, angles: start },
      { at: 1000, angles: start },
      {
        at: 2500,
        angles: { ...start, thumb: target.thumb, index: target.index },
        contact: 1,
      },
    ];
  return [
    { at: 0, angles: start },
    { at: 1000, angles: start },
    { at: 2500, angles: target },
  ];
}

export const calibrations = new Map<string, CameraCalibration>();
export function cal(patient: Patient, scene: Scene): CameraCalibration {
  const key = `${patient.name}|${scene.view}|${scene.hand}|${scene.noise.label}`;
  if (!calibrations.has(key))
    calibrations.set(key, mustCalibrate(patient, scene, 1));
  return calibrations.get(key)!;
}

export function attempt(
  patient: Patient,
  scene: Scene,
  pose: PoseId,
  keys: Keyframe[],
  seed: number,
  opts: StreamOptions = {},
  durationMs = 7500,
): AckResult {
  const camera = cal(patient, scene);
  const samples = stream(patient, scene, keys, durationMs, {
    seed,
    pinchTruth: pose === 'pinch',
    ...opts,
  });
  return acknowledge(pose, samples, runVision(samples, scene, camera), camera);
}

export interface Summary {
  hits: number;
  runs: number;
  latency: number[]; // reachedAt - truthAt, ms
}
export function summarize(results: AckResult[]): Summary {
  return {
    hits: results.filter((r) => r.reachedAt !== null).length,
    runs: results.length,
    latency: results
      .filter((r) => r.reachedAt !== null && r.truthAt !== null)
      .map((r) => r.reachedAt! - r.truthAt!),
  };
}
export const row = (s: Summary) => ({
  hitRate: round(s.hits / s.runs, 2),
  latencyP50ms: Math.round(percentile(s.latency, 50)),
  latencyP95ms: Math.round(percentile(s.latency, 95)),
  latencyMaxMs: s.latency.length ? Math.round(Math.max(...s.latency)) : null,
});
