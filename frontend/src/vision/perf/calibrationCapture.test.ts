/**
 * Calibration capture as the Calibrate page takes it: a 2.1 s hold on a running
 * pipeline, judged by the shared hold-still rule (captureStats in ../calibration.ts).
 * Success on a still hand (with detection dropouts) and refusal of a hand that moves:
 * a capture taken during movement gives a wrong range, which changes assistance.
 */
import { describe, expect, it } from 'vitest';
import type { FingerId } from '../../contracts/vision';
import { captureStats } from '../calibration';
import { FINGERS, fingerMap } from '../flex';
import {
  atClosure,
  NOISE,
  PATIENTS,
  type Keyframe,
  type NoiseModel,
  type Patient,
  type Scene,
} from './handModel';
import { report, round, runVision, stream } from './harness';

const SLOW = { timeout: 120_000 };
const HOLD = 1000; // the pipeline already runs when the helper presses Capture
const CAPTURE = 2125; // the page judges the hold 2.1-2.15 s after it starts
const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
type Endpoint = 'open' | 'closed';

/** The capture's raw flex sums, or null when the hold-still rule refuses it. */
function capture(
  patient: Patient,
  noise: NoiseModel,
  keys: Keyframe[],
  seed: number,
  dropRate = 0,
): Record<FingerId, number> | null {
  const scene: Scene = { view: 'front_upright', hand: 'right', noise };
  const samples = stream(patient, scene, keys, HOLD + CAPTURE, {
    seed: seed * 1000 + 7,
    dropRate,
  });
  const frames = runVision(samples, scene, null).filter((f) => f.t >= HOLD);
  try {
    return captureStats(frames, 2).rawFlexSum;
  } catch {
    return null;
  }
}
const accepted = (...args: Parameters<typeof capture>) =>
  capture(...args) !== null;
const pose = (
  patient: Patient,
  endpoint: Endpoint,
  moved: Partial<Record<FingerId, number>> = {},
) =>
  atClosure(
    patient,
    fingerMap((f) => moved[f] ?? (endpoint === 'open' ? 0 : 1)),
  );
const still = (patient: Patient, endpoint: Endpoint): Keyframe[] => [
  { at: 0, angles: pose(patient, endpoint) },
];
/** Fingers leave the endpoint by `by` of their range during the hold (toward the other endpoint). */
function moving(
  patient: Patient,
  endpoint: Endpoint,
  fingers: readonly FingerId[],
  by: number,
  kind: 'drift' | 'step',
  seed: number,
): Keyframe[] {
  const target = Object.fromEntries(
    fingers.map((f) => [f, endpoint === 'open' ? by : 1 - by]),
  );
  const from = pose(patient, endpoint),
    to = pose(patient, endpoint, target);
  if (kind === 'drift')
    return [
      { at: 0, angles: from },
      { at: HOLD, angles: from },
      { at: HOLD + CAPTURE, angles: to },
    ];
  // A finger closes or opens in 400 ms in the middle of the hold. (A step in its first or
  // last 0.3 s leaves the median on one held posture; the eval in the PR covers those.)
  const start = HOLD + 600 + ((seed * 97) % 500);
  return [
    { at: 0, angles: from },
    { at: start, angles: from },
    { at: start + 400, angles: to },
  ];
}
const rate = (ok: boolean[]) => ok.filter(Boolean).length / ok.length;
const LONG = FINGERS.filter((f) => f !== 'thumb');
/** Landmark noise beyond the severe level: a still hand must be refused. */
const EXTREME: NoiseModel = {
  label: 'extreme (5x)',
  worldXyMm: 3,
  worldZMm: 6,
  depthScale: 1,
  imagePx: 4.3,
};

describe('calibration capture: a still hand is accepted', SLOW, () => {
  // Upright long fingers measure flexion toward the lens (accuracy round 1), so their flex
  // sums are much quieter than with the MCP-arch normal: at 3.5x landmark noise most still
  // captures now pass the unchanged 8 deg std rule (docs/plan/05 B3), where the arch
  // normal's amplified noise refused them. What matters is that an accepted capture is
  // accurate, so 3.5x checks the captured sums against a noise-free capture; noise too
  // large to measure (5x) must still be refused.
  it('at 1x and 2x noise with 0-10% detection dropouts; accurate when accepted at 3.5x, refused at 5x', () => {
    const rows = Object.values(PATIENTS).flatMap((patient) => {
      const ideal = {
        open: capture(patient, NOISE.ideal, still(patient, 'open'), 1)!,
        closed: capture(patient, NOISE.ideal, still(patient, 'closed'), 1)!,
      };
      const range = fingerMap((f) => ideal.closed[f] - ideal.open[f]);
      return [NOISE.bench, NOISE.poorLight, NOISE.severe, EXTREME].flatMap(
        (noise) =>
          (['open', 'closed'] as const).flatMap((endpoint) =>
            [0, 0.1].map((drop) => {
              const sums = SEEDS.map((seed) =>
                capture(patient, noise, still(patient, endpoint), seed, drop),
              ).filter((x) => x !== null);
              const error = (fingers: readonly FingerId[]) =>
                round(
                  Math.max(
                    0,
                    ...sums.flatMap((x) =>
                      fingers.map(
                        (f) =>
                          Math.abs(x[f] - ideal[endpoint][f]) /
                          Math.abs(range[f]),
                      ),
                    ),
                  ),
                  3,
                );
              return {
                patient: patient.name,
                noise: noise.label,
                endpoint,
                dropouts: drop,
                accepted: sums.length / SEEDS.length,
                maxLongError: error(LONG),
                maxThumbError: error(['thumb']),
              };
            }),
          ),
      );
    });
    report(
      'Still-hand calibration captures accepted (10 seeds), and the largest error of an accepted capture (fraction of the range)',
      rows,
    );
    for (const row of rows) {
      const name = `${row.patient} ${row.noise} ${row.endpoint} drop ${row.dropouts}`;
      if (row.noise === EXTREME.label)
        expect(row.accepted, name).toBeLessThanOrEqual(0.2);
      else if (row.noise === NOISE.severe.label) {
        // Measured at most 0.06 (long) and 0.16 (thumb, flexor tone: 45 deg range).
        expect(row.maxLongError, name).toBeLessThanOrEqual(0.1);
        expect(row.maxThumbError, name).toBeLessThanOrEqual(0.2);
      }
      // Weakest cell: the flexor-tone fist at 2x, whose noise is close to the 8 deg limit.
      else expect(row.accepted, name).toBeGreaterThanOrEqual(0.7);
    }
    for (const patient of Object.values(PATIENTS))
      for (const noise of [NOISE.bench, NOISE.poorLight]) {
        const cells = rows.filter(
          (r) => r.patient === patient.name && r.noise === noise.label,
        );
        const mean =
          cells.reduce((sum, r) => sum + r.accepted, 0) / cells.length;
        // Flexor tone at 2x: about 0.9 (0.92 over 20 seeds), bounded by the 8 deg noise limit.
        expect(mean, `${patient.name} ${noise.label}`).toBeGreaterThanOrEqual(
          0.85,
        );
      }
  });
});

describe('calibration capture: a hand that moves is refused', SLOW, () => {
  const cases = (fingers: readonly FingerId[], kind: 'drift' | 'step') =>
    [0.1, 0.15, 0.2, 0.3].map((by) => {
      const ok = Object.values(PATIENTS).flatMap((patient) =>
        (['open', 'closed'] as const).flatMap((endpoint) =>
          [NOISE.bench, NOISE.poorLight].flatMap((noise) =>
            SEEDS.flatMap((seed) =>
              (fingers.length > 1 ? [fingers] : fingers.map((f) => [f])).map(
                (moved) =>
                  accepted(
                    patient,
                    noise,
                    moving(patient, endpoint, moved, by, kind, seed),
                    seed,
                  ),
              ),
            ),
          ),
        ),
      );
      return { by, accepted: round(rate(ok), 3) };
    });
  it('refuses the whole hand drifting or closing by 0.15 of its range or more', () => {
    const rows = (['drift', 'step'] as const).flatMap((kind) =>
      cases(FINGERS, kind).map((r) => ({
        moved: `all fingers, ${kind}`,
        ...r,
      })),
    );
    report(
      'Whole-hand movement during the hold: captures accepted (1x+2x, both patients and endpoints)',
      rows,
    );
    for (const r of rows.filter((r) => r.by >= 0.15))
      expect(r.accepted, `${r.moved} ${r.by}`).toBeLessThanOrEqual(0.05);
  });
  it('refuses one long finger drifting or closing by 0.2 of its range or more', () => {
    const rows = (['drift', 'step'] as const).flatMap((kind) =>
      cases(LONG, kind).map((r) => ({
        moved: `one long finger, ${kind}`,
        ...r,
      })),
    );
    report('One long finger moving during the hold: captures accepted', rows);
    for (const r of rows.filter((r) => r.by >= 0.2))
      expect(r.accepted, `${r.moved} ${r.by}`).toBeLessThanOrEqual(0.05);
  });
  it('refuses the thumb moving by 0.3 of its range in most captures', () => {
    const rows = (['drift', 'step'] as const).flatMap((kind) =>
      cases(['thumb'], kind).map((r) => ({ moved: `thumb, ${kind}`, ...r })),
    );
    report('Thumb moving during the hold: captures accepted', rows);
    for (const r of rows.filter((r) => r.by >= 0.3))
      expect(r.accepted, `${r.moved} ${r.by}`).toBeLessThanOrEqual(0.2);
  });
  // Known gap: the flexor-tone thumb has a 45 deg range, so 0.2 of it is 9 deg, about the
  // 2x-noise level of the open-hand thumb. A stricter thumb limit would refuse still hands.
  it.fails(
    'known gap: refuses a flexor-tone thumb drifting by 0.2 of its range',
    () => {
      const patient = PATIENTS.spastic;
      const ok = (['open', 'closed'] as const).flatMap((endpoint) =>
        SEEDS.map((seed) =>
          accepted(
            patient,
            NOISE.poorLight,
            moving(patient, endpoint, ['thumb'], 0.2, 'drift', seed),
            seed,
          ),
        ),
      );
      expect(rate(ok)).toBeLessThanOrEqual(0.1);
    },
  );
});
