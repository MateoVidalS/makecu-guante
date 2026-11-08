/**
 * Static accuracy of the hand position: how close the published closure is to
 * the true closure while the patient holds a pose. Synthetic hand, production
 * pipeline (FrameProcessor + captureStats). See README.md in this folder.
 */
import { describe, expect, it } from 'vitest';
import type { CameraView } from '../../contracts/calibration';
import { POSES as POSE_DEFS, type PoseId } from '../../contracts/poses';
import type { Handedness } from '../../contracts/vision';
import {
  atClosure,
  FINGERS,
  NOISE,
  PATIENTS,
  performed,
  withNoise,
  type NoiseModel,
  type Patient,
  type Scene,
  type Tilt,
} from './handModel';
import {
  calibrate,
  hold,
  mean,
  mustCalibrate,
  percentile,
  report,
  round,
  runVision,
  std,
  stream,
} from './harness';

const VIEWS: CameraView[] = ['front_upright', 'front_diagonal'];
const HANDS: Handedness[] = ['right', 'left'];
const POSES: PoseId[] = [
  'open',
  'tabletop',
  'hook',
  'straight_fist',
  'full_fist',
];
const SETTLE = 30; // frames (1 s) before scoring a hold
const SLOW = { timeout: 60_000 }; // simulation-heavy; tens of thousands of frames

/** Calibrate, then hold each pose for 3 s; per-finger error statistics over the last 2 s. */
function holdErrors(
  patient: Patient,
  scene: Scene,
  seed: number,
  poses: PoseId[] = POSES,
  measureScene: Scene = scene,
) {
  const camera = mustCalibrate(patient, scene, seed);
  return poses.map((pose) => {
    const samples = stream(
      patient,
      measureScene,
      hold(performed(patient, pose)),
      3000,
      {
        seed: seed * 31 + pose.length,
      },
    );
    const frames = runVision(samples, measureScene, camera).slice(SETTLE);
    const truth = samples.slice(SETTLE);
    const errors = Object.fromEntries(
      FINGERS.map((f) => [
        f,
        frames.map((x, i) => x.closure![f] - truth[i].truth.closure[f]),
      ]),
    );
    // Only fingers the engine scores for this pose (thumb is free in hook/tabletop).
    const scored = FINGERS.filter((f) => POSE_DEFS[pose].closure[f] !== null);
    const all = scored.flatMap((f) => errors[f]);
    return {
      pose,
      fingerBias: Object.fromEntries(FINGERS.map((f) => [f, mean(errors[f])])),
      bias: mean(all),
      worstFingerBias: Math.max(
        ...scored.map((f) => Math.abs(mean(errors[f]))),
      ),
      jitter: Math.max(...scored.map((f) => std(errors[f]))),
      p95: percentile(all.map(Math.abs), 95),
      max: Math.max(...all.map(Math.abs)),
    };
  });
}

describe('hand position accuracy, noise-free (math and geometry)', SLOW, () => {
  it.each(VIEWS.flatMap((view) => HANDS.map((hand) => [view, hand] as const)))(
    'is exact in the %s view for the %s hand, both patients, every pose',
    (view, hand) => {
      for (const patient of Object.values(PATIENTS)) {
        const rows = holdErrors(patient, { view, hand, noise: NOISE.ideal }, 1);
        for (const row of rows)
          expect(row.max, `${patient.name} ${row.pose}`).toBeLessThan(0.005);
      }
    },
  );
  it('does not depend on hand size (small child-size to large adult)', () => {
    const scene: Scene = {
      view: 'front_upright',
      hand: 'right',
      noise: NOISE.ideal,
    };
    for (const size of [0.75, 1, 1.25]) {
      const rows = holdErrors({ ...PATIENTS.healthy, size }, scene, 1);
      for (const row of rows)
        expect(row.max, `size ${size} ${row.pose}`).toBeLessThan(0.005);
    }
  });
  it('does not depend on how the hand is turned after calibration (legacy: yaw, pitch, roll up to 30°; upright: roll)', () => {
    const rolls: Tilt[] = [{ roll: 30 }, { roll: -30 }];
    const tilts: Record<CameraView, Tilt[]> = {
      // Upright long fingers measure toward the lens; pitch/yaw cost is reported below.
      front_upright: rolls,
      front_diagonal: [
        { yaw: 30 },
        { yaw: -30 },
        { pitch: 30 },
        { pitch: -30 },
        ...rolls,
      ],
    };
    for (const view of VIEWS)
      for (const tilt of tilts[view]) {
        const scene: Scene = { view, hand: 'right', noise: NOISE.ideal };
        const rows = holdErrors(PATIENTS.healthy, scene, 1, POSES, {
          ...scene,
          tilt,
        });
        for (const row of rows)
          expect(
            row.max,
            `${view} ${JSON.stringify(tilt)} ${row.pose}`,
          ).toBeLessThan(0.005);
      }
  });
  it('upright: reports the closure cost of pitching or yawing the hand after calibration', () => {
    // MediaPipe barely reports a near-frontal palm's tilt (bench: rendered ±25°
    // pitch/yaw leave its world palm normal unchanged), so upright long fingers
    // measure toward the lens. This model's landmarks are exact geometry, so it
    // shows the price of that choice; the bench measures what real MediaPipe does.
    const LONG = ['index', 'middle', 'ring', 'pinky'] as const;
    const rows: Record<string, string | number>[] = [];
    for (const hand of HANDS)
      for (const noise of [NOISE.ideal, NOISE.bench])
        for (const axis of ['pitch', 'yaw'] as const)
          for (const degrees of [-35, -25, -15, 15, 25, 35]) {
            const scene: Scene = { view: 'front_upright', hand, noise };
            const tilted = holdErrors(PATIENTS.healthy, scene, 1, POSES, {
              ...scene,
              tilt: { [axis]: degrees },
            });
            const biases = tilted.flatMap((row) =>
              LONG.map((f) => row.fingerBias[f]),
            );
            rows.push({
              hand,
              noise: noise.label,
              tilt: `${axis} ${degrees}`,
              meanAbsLongBias: round(mean(biases.map(Math.abs))),
              worstLongBias: round(
                biases.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a)),
              ),
              ...Object.fromEntries(
                tilted.map((row) => [
                  row.pose,
                  round(mean(LONG.map((f) => row.fingerBias[f]))),
                ]),
              ),
            });
          }
    report(
      'Upright long-finger closure bias after turning the hand (healthy patient, calibrated frontal)',
      rows,
    );
    // Guard the documented cost: about 0.05 at 15° and 0.09 at 25°.
    for (const row of rows) {
      const degrees = Math.abs(Number(String(row.tilt).split(' ')[1]));
      const limit = degrees <= 15 ? 0.06 : degrees <= 25 ? 0.1 : 0.13;
      expect(
        row.meanAbsLongBias,
        `${row.hand} ${row.noise} ${row.tilt}`,
      ).toBeLessThan(limit);
    }
  });
});

describe(
  'hand position accuracy with MediaPipe-like landmark error',
  SLOW,
  () => {
    // `severe` is left out here: calibration refuses it (see the calibration capture test).
    const levels: NoiseModel[] = [NOISE.bench, NOISE.poorLight];
    const table = (patient: Patient, view: CameraView, noise: NoiseModel) => {
      const seeds = [1, 2, 3];
      const runs = seeds.map((seed) =>
        holdErrors(patient, { view, hand: 'right', noise }, seed),
      );
      return POSES.map((pose, k) => ({
        view,
        patient: patient.name,
        noise: noise.label,
        pose,
        bias: round(mean(runs.map((r) => r[k].bias))),
        worstFingerBias: round(
          Math.max(...runs.map((r) => r[k].worstFingerBias)),
        ),
        jitterStd: round(Math.max(...runs.map((r) => r[k].jitter))),
        p95AbsErr: round(Math.max(...runs.map((r) => r[k].p95))),
        maxAbsErr: round(Math.max(...runs.map((r) => r[k].max))),
      }));
    };

    // Static jitterStd measured on #62 (7b0092e), in POSES order. Retain a
    // per-row limit so improvements in one pose cannot hide regressions in another.
    const jitterBaseline = {
      front_upright: {
        healthy: [0.01, 0.007, 0.012, 0.013, 0.016],
        spastic: [0.015, 0.018, 0.022, 0.034, 0.046],
        poorLight: [0.065, 0.052, 0.065, 0.123, 0.142],
      },
      front_diagonal: {
        healthy: [0.011, 0.008, 0.005, 0.014, 0.017],
        spastic: [0.023, 0.012, 0.009, 0.035, 0.044],
        poorLight: [0.084, 0.036, 0.031, 0.129, 0.118],
      },
    };
    const checkJitter = (rows: ReturnType<typeof table>) => {
      for (const r of rows) {
        const group =
          r.noise === NOISE.poorLight.label
            ? 'poorLight'
            : r.patient === PATIENTS.healthy.name
              ? 'healthy'
              : 'spastic';
        const before = jitterBaseline[r.view][group][POSES.indexOf(r.pose)];
        expect(
          r.jitterStd,
          `${r.view} ${r.patient} ${r.noise} ${r.pose} jitter`,
        ).toBeLessThanOrEqual(before * 1.2);
      }
    };

    it('keeps every held pose inside the reach tolerance (0.10) at the benchmarked noise', () => {
      const rows = VIEWS.flatMap((view) =>
        Object.values(PATIENTS).flatMap((patient) =>
          table(patient, view, NOISE.bench),
        ),
      );
      report(
        'Static accuracy at benchmarked MediaPipe noise (closure units, 1 = calibrated range)',
        rows,
      );
      checkJitter(rows);
      for (const row of rows) {
        const name = `${row.view} ${row.patient} ${row.pose}`;
        expect(row.p95AbsErr, name).toBeLessThan(0.1);
        // A steady bias eats into the tolerance for every attempt; keep it under 3/4 of it.
        expect(row.worstFingerBias, name).toBeLessThan(0.075);
      }
    });

    it('reports thumb and long-finger bias separately', () => {
      const rows = VIEWS.flatMap((view) =>
        POSES.map((pose, k) => {
          const runs = [1, 2, 3].map(
            (seed) =>
              holdErrors(
                PATIENTS.healthy,
                { view, hand: 'right', noise: NOISE.bench },
                seed,
              )[k],
          );
          return {
            view,
            pose,
            scored: POSE_DEFS[pose].closure.thumb !== null,
            thumbBias: round(mean(runs.map((r) => r.fingerBias.thumb))),
            longFingerBias: round(
              mean(
                runs.map((r) =>
                  mean(FINGERS.slice(1).map((f) => r.fingerBias[f])),
                ),
              ),
            ),
          };
        }),
      );
      report(
        'Thumb vs long-finger bias at benchmarked noise (thumb has 2 short bones and ~100° of range)',
        rows,
      );
      // Wherever the thumb is scored, its bias must stay under 3/4 of the tolerance.
      for (const row of rows.filter((r) => r.scored))
        expect(Math.abs(row.thumbBias), `${row.view} ${row.pose}`).toBeLessThan(
          0.075,
        );
      // Keep the broad per-view guard alongside the tighter upright regression.
      for (const row of rows)
        expect(
          Math.abs(row.longFingerBias),
          `${row.view} ${row.pose}`,
        ).toBeLessThan(0.04);
    });

    it('long-finger bias stays under 0.03 for every pose (upright view)', () => {
      for (const seed of [1, 2, 3]) {
        const rows = holdErrors(
          PATIENTS.healthy,
          { view: 'front_upright', hand: 'right', noise: NOISE.bench },
          seed,
        );
        for (const r of rows)
          expect(
            Math.abs(mean(FINGERS.slice(1).map((f) => r.fingerBias[f]))),
            r.pose,
          ).toBeLessThan(0.03);
      }
    });

    it('degrades gracefully as noise grows (report + ordering)', () => {
      const rows = VIEWS.flatMap((view) =>
        levels.flatMap((noise) => table(PATIENTS.spastic, view, noise)),
      );
      report(
        'Static accuracy vs noise level (spastic patient: small range, so noise weighs more)',
        rows,
      );
      checkJitter(rows);
      for (const view of VIEWS) {
        const p95 = levels.map((noise) =>
          Math.max(
            ...rows
              .filter((r) => r.view === view && r.noise === noise.label)
              .map((r) => r.p95AbsErr),
          ),
        );
        expect(p95[0]).toBeLessThanOrEqual(p95[1]);
        // Poor-light noise: still usable, but no longer inside the tolerance everywhere.
        expect(p95[1], view).toBeLessThan(0.25);
      }
    });

    it('measures the bias from MediaPipe flattening the hand in depth (fingers curl toward the lens when upright)', () => {
      const rows = VIEWS.flatMap((view) =>
        [1, 0.85, 0.7].flatMap((depthScale) => {
          const noise = withNoise(NOISE.ideal, {
            depthScale,
            label: `depth x${depthScale}`,
          });
          return holdErrors(
            PATIENTS.healthy,
            { view, hand: 'right', noise },
            1,
          ).map((r) => ({
            view,
            depthScale,
            pose: r.pose,
            bias: round(r.bias),
            worstFingerBias: round(r.worstFingerBias),
          }));
        }),
      );
      report(
        'Closure bias from depth flattening (no random noise; calibration absorbs the endpoints only)',
        rows,
      );
      // Endpoints are calibrated away; mid-range poses carry the bias.
      for (const row of rows.filter(
        (r) => r.pose === 'open' || r.pose === 'full_fist',
      ))
        expect(
          Math.abs(row.bias),
          `${row.view} ${row.depthScale} ${row.pose}`,
        ).toBeLessThan(0.02);
      const worst = (view: CameraView) =>
        Math.max(
          ...rows
            .filter((r) => r.view === view && r.depthScale === 0.7)
            .map((r) => r.worstFingerBias),
        );
      report('Worst mid-range bias at 30% depth flattening', [
        { view: 'front_upright', worstFingerBias: worst('front_upright') },
        { view: 'front_diagonal', worstFingerBias: worst('front_diagonal') },
      ]);
    });

    it('linearity: measured vs true closure over the whole range (every joint flexed alike)', () => {
      // Signed joint angles should preserve low closures despite near-zero landmark noise.
      const levels = [0, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9, 1];
      const rows = VIEWS.flatMap((view) =>
        [NOISE.ideal, NOISE.bench, NOISE.poorLight].map((noise) => {
          const scene: Scene = { view, hand: 'right', noise };
          const camera = mustCalibrate(PATIENTS.healthy, scene, 1);
          const cells: Record<string, number> = {};
          for (const level of levels) {
            const angles = atClosure(PATIENTS.healthy, {
              thumb: level,
              index: level,
              middle: level,
              ring: level,
              pinky: level,
            });
            const samples = stream(
              PATIENTS.healthy,
              scene,
              hold(angles),
              3000,
              { seed: 5 },
            );
            const frames = runVision(samples, scene, camera).slice(SETTLE);
            cells[`long@${level}`] =
              mean(
                frames.flatMap((f) =>
                  FINGERS.slice(1).map((x) => f.closure![x]),
                ),
              ) - level;
            cells[`thumb@${level}`] =
              mean(frames.map((f) => f.closure!.thumb)) - level;
          }
          return { view, noise: noise.label, ...cells } as {
            view: CameraView;
            noise: string;
          } & Record<string, number>;
        }),
      );
      report(
        'Closure error (measured − true) vs true closure, all joints flexed alike',
        rows.map((r) =>
          Object.fromEntries(
            Object.entries(r).map(([key, value]) => [
              key,
              typeof value === 'number' ? round(value) : value,
            ]),
          ),
        ),
      );
      for (const r of rows) {
        const name = `${r.view} ${r.noise}`;
        if (r.noise === NOISE.ideal.label)
          for (const level of levels)
            for (const finger of ['long', 'thumb'])
              expect(
                Math.abs(r[`${finger}@${level}`] as number),
                name,
              ).toBeLessThan(0.005);
        if (r.noise === NOISE.bench.label)
          for (const level of levels) {
            expect(
              Math.abs(r[`long@${level}`] as number),
              `${name} long@${level}`,
            ).toBeLessThanOrEqual(0.02);
            expect(
              Math.abs(r[`thumb@${level}`] as number),
              `${name} thumb@${level}`,
            ).toBeLessThanOrEqual(0.04);
          }
      }
    });
  },
);

describe(
  'calibration capture (Calibrate page: 2 s hold, ≤ 8° movement)',
  SLOW,
  () => {
    it('succeeds at the benchmarked and poor-light noise, and reports where it starts refusing', () => {
      const rows = VIEWS.flatMap((view) =>
        Object.values(PATIENTS).flatMap((patient) =>
          [NOISE.bench, NOISE.poorLight, NOISE.severe].map((noise) => {
            const seeds = Array.from({ length: 10 }, (_, i) => i + 1);
            const ok = seeds.filter(
              (seed) =>
                !(
                  'error' in
                  calibrate(patient, { view, hand: 'right', noise }, seed)
                ),
            );
            return {
              view,
              patient: patient.name,
              noise: noise.label,
              successRate: ok.length / seeds.length,
            };
          }),
        ),
      );
      report('Calibration capture success rate (10 seeds)', rows);
      for (const row of rows.filter((r) => r.noise !== NOISE.severe.label))
        expect(
          row.successRate,
          `${row.view} ${row.patient} ${row.noise}`,
        ).toBeGreaterThanOrEqual(0.9);
    });

    it('captures the spastic hand at 2x noise in ≥ 90% of tries (upright view)', () => {
      const seeds = Array.from({ length: 10 }, (_, i) => i + 1);
      const ok = seeds.filter(
        (seed) =>
          !(
            'error' in
            calibrate(
              PATIENTS.spastic,
              { view: 'front_upright', hand: 'right', noise: NOISE.poorLight },
              seed,
            )
          ),
      );
      expect(ok.length / seeds.length).toBeGreaterThanOrEqual(0.9);
    });
  },
);
