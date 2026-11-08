/**
 * Timing of hand-position recognition: how far the published closure lags the
 * real hand, what frame rate and detection dropouts do to acknowledgment, and
 * how much CPU the per-frame pipeline costs (MediaPipe inference excluded; see
 * mediapipe-bench.result.json for that).
 */
import { describe, expect, it } from 'vitest';
import type { CameraView } from '../../contracts/calibration';
import { DEFAULT_EXERCISE_SETTINGS, type PoseId } from '../../contracts/poses';
import { createExerciseEngine } from '../../engine';
import calibrationFixture from '../../../../contracts/fixtures/calibration.json';
import type { Calibration } from '../../contracts/calibration';
import { FrameProcessor } from '../frameProcessor';
import {
  FINGERS,
  NOISE,
  PATIENTS,
  performed,
  rng,
  type Scene,
} from './handModel';
import {
  mean,
  mustCalibrate,
  percentile,
  report,
  round,
  runVision,
  stream,
} from './harness';
import { attempt, reach, row, SEEDS, summarize } from './scenarios';

const SLOW = { timeout: 120_000 };
const VIEWS: CameraView[] = ['front_upright', 'front_diagonal'];

describe('tracking lag of the published closure (noise-free)', SLOW, () => {
  it('follows a reach within ~0.2 s at mid-range and is within 0.05 of the hand 0.45 s after it stops', () => {
    const patient = PATIENTS.healthy;
    const rows = [];
    for (const view of VIEWS)
      for (const moveMs of [500, 1000, 2000]) {
        const scene: Scene = { view, hand: 'right', noise: NOISE.ideal };
        const camera = mustCalibrate(patient, scene, 1);
        const keys = [
          { at: 0, angles: patient.open },
          { at: 1000, angles: patient.open },
          { at: 1000 + moveMs, angles: performed(patient, 'full_fist') },
        ];
        const samples = stream(patient, scene, keys, 1000 + moveMs + 1500);
        const frames = runVision(samples, scene, camera);
        const crossing = (values: number[], level: number) => {
          const i = values.findIndex((v) => v >= level);
          return i < 0 ? NaN : samples[i].t;
        };
        const lag = (level: number) =>
          mean(
            FINGERS.map(
              (f) =>
                crossing(
                  frames.map((x) => x.closure![f]),
                  level,
                ) -
                crossing(
                  samples.map((x) => x.truth.closure[f]),
                  level,
                ),
            ),
          );
        const end = 1000 + moveMs;
        const settle = (within: number) => {
          const k = frames.findIndex(
            (x, n) =>
              samples[n].t >= end &&
              frames
                .slice(n)
                .every((y, m) =>
                  FINGERS.every(
                    (f) =>
                      Math.abs(
                        y.closure![f] - samples[n + m].truth.closure[f],
                      ) < within,
                  ),
                ),
          );
          return k < 0 ? null : Math.round(samples[k].t - end);
        };
        rows.push({
          view,
          moveMs,
          lagAt25pctMs: Math.round(lag(0.25)),
          lagAt50pctMs: Math.round(lag(0.5)),
          lagAt85pctMs: Math.round(lag(0.85)),
          settleWithin005Ms: settle(0.05),
          settleWithin002Ms: settle(0.02),
        });
      }
    report(
      'Closure lag behind the true hand (One Euro joint filter), full fist reach',
      rows,
    );
    for (const r of rows) {
      const name = `${r.view} ${r.moveMs} ms`;
      expect(r.lagAt50pctMs, name).toBeLessThan(200);
      expect(r.settleWithin005Ms, name).not.toBeNull();
      expect(r.settleWithin005Ms!, name).toBeLessThan(450);
      // The last 2% has a slow tail (minCutoff 0.3 Hz once the hand is still): reported, bounded loosely.
      expect(r.settleWithin002Ms!, name).toBeLessThan(1200);
    }
  });
});

describe('camera frame rate', SLOW, () => {
  it('acknowledges at 30, 20 and 15 fps (laptop webcams drop to 15 fps in low light)', () => {
    const rows = [];
    for (const fps of [30, 20, 15])
      for (const pose of ['open', 'hook', 'full_fist', 'pinch'] as PoseId[]) {
        const scene: Scene = {
          view: 'front_upright',
          hand: 'right',
          noise: NOISE.bench,
        };
        const s = summarize(
          SEEDS.map((seed) =>
            attempt(
              PATIENTS.healthy,
              scene,
              pose,
              reach(PATIENTS.healthy, pose),
              seed,
              { fps, jitterMs: 4 },
            ),
          ),
        );
        rows.push({ fps, pose, ...row(s) });
      }
    report(
      'Acknowledgment vs camera frame rate (front_upright, benchmarked noise, ±4 ms frame jitter)',
      rows,
    );
    for (const r of rows) expect(r.hitRate, `${r.fps} fps ${r.pose}`).toBe(1);
  });
});

describe('detection dropouts (MediaPipe misses a frame)', SLOW, () => {
  // A missed detection publishes a missing frame; the engine resets the 0.5 s dwell on it.
  const rates = [0, 0.01, 0.02, 0.05, 0.1, 0.2];
  const run = (dropRate: number, pose: PoseId) =>
    summarize(
      SEEDS.map((seed) =>
        attempt(
          PATIENTS.healthy,
          { view: 'front_upright', hand: 'right', noise: NOISE.bench },
          pose,
          reach(PATIENTS.healthy, pose),
          seed,
          { dropRate },
        ),
      ),
    );

  it('reports hit rate and latency vs random miss rate', () => {
    const rows = rates.flatMap((dropRate) =>
      (['hook', 'full_fist'] as PoseId[]).map((pose) => ({
        dropRate,
        pose,
        ...row(run(dropRate, pose)),
      })),
    );
    report(
      'Acknowledgment vs random detection misses (each miss restarts the 0.5 s dwell)',
      rows,
    );
    for (const r of rows.filter((x) => x.dropRate <= 0.02)) {
      expect(r.hitRate, `${r.dropRate} ${r.pose}`).toBe(1);
      expect(r.latencyP95ms, `${r.dropRate} ${r.pose}`).toBeLessThan(1500);
    }
  });

  // Known gap: one missed frame restarts the whole dwell, so the dwell needs ~15 consecutive good frames.
  // At a 10% miss rate (plausible with a glove or poor light) some correct poses are never acknowledged.
  it.fails(
    'at a 10% miss rate, at least 95% of correct poses are acknowledged',
    () => {
      const s = [run(0.1, 'hook'), run(0.1, 'full_fist')];
      expect(
        s.reduce((a, x) => a + x.hits, 0) / s.reduce((a, x) => a + x.runs, 0),
      ).toBeGreaterThanOrEqual(0.95);
    },
  );

  it('a 150 ms occlusion during the hold delays acknowledgment by at most the dwell, never loses it', () => {
    const patient = PATIENTS.healthy;
    const scene: Scene = {
      view: 'front_upright',
      hand: 'right',
      noise: NOISE.bench,
    };
    const camera = mustCalibrate(patient, scene, 1);
    const samples = stream(patient, scene, reach(patient, 'hook'), 7500, {
      seed: 4,
    });
    const truthOk = samples.findIndex((s) => s.truth.closure.index >= 0.5);
    // Hide the hand 100 ms after the true hand reaches the band, for 150 ms.
    const from = samples[truthOk].t + 100;
    const occluded = samples.map((s) =>
      s.t >= from && s.t < from + 150
        ? {
            ...s,
            result: { landmarks: [], worldLandmarks: [], handedness: [] },
          }
        : s,
    );
    const frames = runVision(occluded, scene, camera);
    const clean = runVision(samples, scene, camera);
    const ack = (fr: typeof frames, ss: typeof samples) => {
      const engine = createExerciseEngine();
      engine.start(
        [{ pose: 'hook', reps: 1 }],
        { ...DEFAULT_EXERCISE_SETTINGS, present_s: 0, assist_enabled: false },
        { ...(calibrationFixture as Calibration), camera },
        fr[0].t,
      );
      let k = 0;
      for (let now = fr[0].t; now <= ss.at(-1)!.t; now += 20) {
        while (k + 1 < fr.length && fr[k + 1].t <= now) k++;
        const out = engine.tick({
          now,
          vision: fr[k],
          tel: {
            t: now,
            ms: now,
            a: [0, 0, 0, 0, 0],
            ma: 80,
            st: 'idle',
            md: 'none',
            tg: [0, 0, 0, 0, 0],
          },
          gloveEvents: [],
          gloveConnected: true,
        });
        if (out.events.some((e) => e.kind === 'reached')) return now;
      }
      return null;
    };
    const withGap = ack(frames, occluded),
      without = ack(clean, samples);
    report('150 ms occlusion during the hold', [
      {
        cleanAckMs: without,
        occludedAckMs: withGap,
        delayMs: withGap! - without!,
      },
    ]);
    expect(without).not.toBeNull();
    expect(withGap).not.toBeNull();
    expect(withGap! - without!).toBeLessThanOrEqual(
      DEFAULT_EXERCISE_SETTINGS.reach_dwell_s * 1000 + 200,
    );
  });
});

describe(
  'per-frame CPU cost (budget: 33 ms per frame at 30 fps, shared with MediaPipe and rendering)',
  SLOW,
  () => {
    it('FrameProcessor and ExerciseEngine.tick stay far below a millisecond', () => {
      const patient = PATIENTS.healthy;
      const scene: Scene = {
        view: 'front_upright',
        hand: 'right',
        noise: NOISE.bench,
      };
      const camera = mustCalibrate(patient, scene, 1);
      const samples = stream(
        patient,
        scene,
        reach(patient, 'full_fist'),
        60_000,
        { seed: 9 },
      );
      const processor = new FrameProcessor();
      processor.calibration = camera;
      const processMs: number[] = [];
      const frames = samples.map((s) => {
        const start = performance.now();
        const frame = processor.process(
          s.result,
          s.t,
          'right',
          false,
          scene.view,
        );
        processMs.push(performance.now() - start);
        return frame;
      });
      const engine = createExerciseEngine();
      engine.start(
        [{ pose: 'full_fist', reps: 50 }],
        { ...DEFAULT_EXERCISE_SETTINGS, present_s: 0 },
        { ...(calibrationFixture as Calibration), camera },
        0,
      );
      const tickMs: number[] = [];
      const rand = rng(1);
      for (const [i, frame] of frames.entries()) {
        const start = performance.now();
        engine.tick({
          now: frame.t,
          vision: frame,
          tel: {
            t: frame.t,
            ms: frame.t,
            a: [0, 0, 0, 0, 0],
            ma: 80 + rand(),
            st: i % 2 ? 'run' : 'idle',
            md: 'follow',
            tg: [0, 0, 0, 0, 0],
          },
          gloveEvents: [],
          gloveConnected: true,
        });
        tickMs.push(performance.now() - start);
      }
      const stats = (v: number[]) => ({
        p50: round(percentile(v, 50), 4),
        p95: round(percentile(v, 95), 4),
        p99: round(percentile(v, 99), 4),
      });
      report(
        'Per-frame CPU cost in ms (jsdom/Node; browsers are similar or faster)',
        [
          {
            stage: 'FrameProcessor.process',
            frames: processMs.length,
            ...stats(processMs),
          },
          {
            stage: 'ExerciseEngine.tick',
            frames: tickMs.length,
            ...stats(tickMs),
          },
        ],
      );
      // Generous bounds so a busy CI machine does not flake; real values are ~10-50 µs.
      expect(percentile(processMs, 50)).toBeLessThan(0.5);
      expect(percentile(processMs, 95)).toBeLessThan(3);
      expect(percentile(tickMs, 50)).toBeLessThan(0.5);
      expect(percentile(tickMs, 95)).toBeLessThan(3);
    });
  },
);
