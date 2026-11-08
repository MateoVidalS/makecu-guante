/**
 * Pose acknowledgment: does the real ExerciseEngine emit `reached` when the
 * patient makes the pose, how fast, and does it refuse when they don't?
 * Synthetic hand -> FrameProcessor -> ExerciseEngine (observation only, no glove help).
 */
import { describe, expect, it } from 'vitest';
import type { CameraView } from '../../contracts/calibration';
import {
  DEFAULT_EXERCISE_SETTINGS,
  POSES,
  type PoseId,
} from '../../contracts/poses';
import type { Handedness } from '../../contracts/vision';
import {
  atClosure,
  FINGERS,
  NOISE,
  PATIENTS,
  performed,
  shaped,
  type HandAngles,
  type NoiseModel,
  type Patient,
  type Scene,
} from './handModel';
import { report, round, runVision, stream } from './harness';
import { attempt, cal, reach, row, SEEDS, summarize } from './scenarios';

const SLOW = { timeout: 120_000 };
/**
 * These sweeps run for 10-20 s of synchronous work. Vitest's worker must answer its runner
 * within 60 s, and on a busy machine one uninterrupted sweep can exceed that ("Timeout calling
 * onTaskUpdate", reported as an unhandled error while every test passes). Yield between rows.
 */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const VIEWS: CameraView[] = ['front_upright', 'front_diagonal'];
const HANDS: Handedness[] = ['right', 'left'];
const TENDON: PoseId[] = [
  'open',
  'tabletop',
  'hook',
  'straight_fist',
  'full_fist',
];
const ALL: PoseId[] = [...TENDON, 'pinch'];
const DWELL_MS = DEFAULT_EXERCISE_SETTINGS.reach_dwell_s * 1000;
const TOL = DEFAULT_EXERCISE_SETTINGS.tolerance;
/**
 * Latency budgets, measured from the moment the true hand satisfies the rule.
 * Tendon poses: dwell + joint smoothing. Pinch is slower: the pinch ratio has its own
 * One Euro filter and the fingertips approach slowly at the end of the reach.
 */
const LATENCY = {
  close: { lagMs: 400, p95Ms: 1000 },
  // Opening ends slowly as it approaches 0, where the 0.10 band is crossed late in the movement.
  open: { lagMs: 700, p95Ms: 1400 },
  pinch: { lagMs: 800, p95Ms: 1200 },
};
const budget = (pose: PoseId) =>
  pose === 'pinch'
    ? LATENCY.pinch
    : pose === 'open'
      ? LATENCY.open
      : LATENCY.close;

describe('acknowledges every pose the patient really makes', SLOW, () => {
  it('noise-free: 100% acknowledged, latency = dwell (0.5 s) plus smoothing lag', () => {
    const rows = [];
    for (const view of VIEWS)
      for (const patient of Object.values(PATIENTS))
        for (const pose of ALL) {
          const scene: Scene = { view, hand: 'right', noise: NOISE.ideal };
          const s = summarize([
            attempt(patient, scene, pose, reach(patient, pose), 1),
          ]);
          rows.push({ view, patient: patient.name, pose, ...row(s) });
        }
    report('Acknowledgment, noise-free', rows);
    for (const r of rows) {
      const name = `${r.view} ${r.patient} ${r.pose}`;
      expect(r.hitRate, name).toBe(1);
      // Never sooner than the dwell: the engine must see the pose held for 0.5 s.
      expect(r.latencyP50ms, name).toBeGreaterThanOrEqual(DWELL_MS - 40);
      expect(r.latencyP50ms, name).toBeLessThan(
        DWELL_MS + budget(r.pose).lagMs,
      );
    }
  });

  it('benchmarked noise: every pose, view, hand and patient is acknowledged in time', async () => {
    const rows = [];
    for (const view of VIEWS)
      for (const hand of HANDS)
        for (const patient of Object.values(PATIENTS))
          for (const pose of ALL) {
            const scene: Scene = { view, hand, noise: NOISE.bench };
            const s = summarize(
              SEEDS.map((seed) =>
                attempt(patient, scene, pose, reach(patient, pose), seed),
              ),
            );
            rows.push({ view, hand, patient: patient.name, pose, ...row(s) });
            await breathe();
          }
    report('Acknowledgment at benchmarked noise (8 attempts per row)', rows);
    for (const r of rows) {
      const name = `${r.view} ${r.hand} ${r.patient} ${r.pose}`;
      expect(r.hitRate, name).toBe(1);
      expect(r.latencyP95ms, name).toBeLessThan(budget(r.pose).p95Ms);
    }
  });

  it('poor-light noise (2x): reports hit rate and latency', async () => {
    const rows = [];
    for (const view of VIEWS)
      for (const patient of Object.values(PATIENTS))
        for (const pose of ALL) {
          const scene: Scene = { view, hand: 'right', noise: NOISE.poorLight };
          const s = summarize(
            SEEDS.map((seed) =>
              attempt(patient, scene, pose, reach(patient, pose), seed),
            ),
          );
          rows.push({ view, patient: patient.name, pose, ...row(s) });
          await breathe();
        }
    report('Acknowledgment at 2x noise (poor light)', rows);
    const overall = rows.reduce((a, r) => a + r.hitRate, 0) / rows.length;
    expect(overall).toBeGreaterThan(0.9);
  });
});

describe(
  'known gaps (it.fails: passes while the gap exists; fix the code, then flip to it)',
  SLOW,
  () => {
    // The rendered pinch must satisfy its target even with full-range calibration.
    it('copying the on-screen pinch is acknowledged (full-range calibration)', () => {
      const patient = PATIENTS.healthy;
      const scene: Scene = {
        view: 'front_upright',
        hand: 'right',
        noise: NOISE.ideal,
      };
      const result = attempt(
        patient,
        scene,
        'pinch',
        reach(patient, 'pinch', performed(patient, 'pinch')),
        1,
      );
      expect(result.reachedAt).not.toBeNull();
    });

    // Signed flexion must preserve the thumb's margin inside the reach tolerance.
    it('a thumb exactly on its straight-fist target keeps at least half the tolerance of margin (upright, benchmarked noise)', () => {
      const patient = PATIENTS.healthy;
      const scene: Scene = {
        view: 'front_upright',
        hand: 'right',
        noise: NOISE.bench,
      };
      const camera = cal(patient, scene);
      const goal = shaped(patient, 'straight_fist', {
        thumb: POSES.straight_fist.closure.thumb,
        index: 0.7,
        middle: 0.7,
        ring: 0.7,
        pinky: 0.7,
      });
      const samples = stream(
        patient,
        scene,
        reach(patient, 'straight_fist', goal),
        6000,
        { seed: 3 },
      );
      const thumb = runVision(samples, scene, camera)
        .slice(-60)
        .map((f) => f.closure!.thumb);
      const measured = thumb.reduce((a, b) => a + b, 0) / thumb.length;
      report('Thumb exactly at the straight-fist target', [
        {
          view: scene.view,
          target: POSES.straight_fist.closure.thumb,
          measured: round(measured),
          margin: round(measured - (POSES.straight_fist.closure.thumb! - TOL)),
        },
      ]);
      expect(measured).toBeGreaterThanOrEqual(
        POSES.straight_fist.closure.thumb! - TOL / 2,
      );
    });

    it('a straight fist held 0.05 short of every target (inside the 0.10 tolerance) is acknowledged (upright, benchmarked noise)', () => {
      const patient = PATIENTS.healthy;
      const scene: Scene = {
        view: 'front_upright',
        hand: 'right',
        noise: NOISE.bench,
      };
      const goal = shaped(patient, 'straight_fist', {
        thumb: 0.45,
        index: 0.65,
        middle: 0.65,
        ring: 0.65,
        pinky: 0.65,
      });
      const s = summarize(
        SEEDS.map((seed) =>
          attempt(
            patient,
            scene,
            'straight_fist',
            reach(patient, 'straight_fist', goal),
            seed,
          ),
        ),
      );
      expect(s.hits / s.runs).toBeGreaterThanOrEqual(0.9);
    });
  },
);

describe(
  'refuses poses the patient does not make (false acknowledgments)',
  SLOW,
  () => {
    /**
     * Every scored finger held at `target + offset` (offset < 0 = short of the target), keeping
     * the pose's own shape. For `open`, "short" means still closed by -offset, all joints alike.
     */
    function offsetGoal(
      patient: Patient,
      pose: PoseId,
      offset: number,
    ): HandAngles {
      if (pose === 'open')
        return atClosure(
          patient,
          Object.fromEntries(
            FINGERS.map((f) => [f, Math.max(0, -offset)]),
          ) as Record<(typeof FINGERS)[number], number>,
        );
      const desired = Object.fromEntries(
        FINGERS.map((f) => {
          const target = POSES[pose].closure[f];
          return [
            f,
            target === null ? null : Math.max(0, Math.min(1, target + offset)),
          ];
        }),
      );
      return shaped(patient, pose, desired);
    }
    const ackRate = (
      patient: Patient,
      noise: NoiseModel,
      view: CameraView,
      pose: PoseId,
      offset: number,
    ) =>
      summarize(
        SEEDS.map((seed) =>
          attempt(
            patient,
            { view, hand: 'right', noise },
            pose,
            reach(patient, pose, offsetGoal(patient, pose, offset)),
            seed,
          ),
        ),
      );

    it('psychometric curve: acknowledgment probability vs how far each finger stops from the target', async () => {
      const offsets = [-0.3, -0.2, -0.15, -0.12, -0.1, -0.08, -0.05, 0];
      const rows: ({ view: CameraView; pose: PoseId } & Record<
        string,
        number | string
      >)[] = [];
      for (const view of VIEWS)
        for (const pose of TENDON) {
          const rates: Record<string, number> = {};
          for (const offset of offsets) {
            rates[`${offset}`] = round(
              ackRate(PATIENTS.healthy, NOISE.bench, view, pose, offset).hits /
                SEEDS.length,
              2,
            );
            await breathe();
          }
          rows.push({ view, pose, ...rates });
        }
      report(
        `Acknowledgment probability vs offset from target (tolerance ${TOL}, benchmarked noise)`,
        rows,
      );
      for (const r of rows) {
        const name = `${r.view} ${r.pose}`;
        // Well short of the target: never acknowledged. On target: always.
        expect(r['-0.3'], name).toBe(0);
        expect(r['-0.2'], name).toBe(0);
        expect(r['-0.05'], name).toBe(1);
        expect(r['0'], name).toBe(1);
      }
    });

    it('does not acknowledge when a single finger lags (four fingers reach, the pinky stays 0.25 short)', () => {
      for (const view of VIEWS)
        for (const pose of ['hook', 'straight_fist', 'full_fist'] as PoseId[]) {
          const goal = performed(PATIENTS.healthy, pose);
          const lagging = atClosure(PATIENTS.healthy, {
            thumb: POSES[pose].closure.thumb ?? 0,
            index: 0,
            middle: 0,
            ring: 0,
            pinky: Math.max(0, POSES[pose].closure.pinky! - 0.25),
          });
          const keys = reach(PATIENTS.healthy, pose, {
            ...goal,
            pinky: lagging.pinky,
          });
          const s = summarize(
            SEEDS.map((seed) =>
              attempt(
                PATIENTS.healthy,
                { view, hand: 'right', noise: NOISE.bench },
                pose,
                keys,
                seed,
              ),
            ),
          );
          expect(s.hits, `${view} ${pose}`).toBe(0);
        }
    });

    it('pinch: an almost-closed pinch (thumb tip 2 cm from the index tip) is not acknowledged', () => {
      for (const view of VIEWS) {
        const keys = reach(PATIENTS.healthy, 'pinch').map((k) => ({
          ...k,
          contact: (k.contact ?? 0) * 0.55,
        }));
        const s = summarize(
          SEEDS.map((seed) =>
            attempt(
              PATIENTS.healthy,
              { view, hand: 'right', noise: NOISE.bench },
              'pinch',
              keys,
              seed,
            ),
          ),
        );
        expect(s.hits, view).toBe(0);
      }
    });

    it('documented limitation (06-session §2): closure is a joint-angle sum, so a fuller pose satisfies a lighter one', () => {
      const matrix: ({ performed: PoseId } & Record<string, string>)[] = [];
      const view: CameraView = 'front_upright';
      for (const performedPose of TENDON) {
        const cells: Record<string, string> = {};
        for (const asked of TENDON) {
          const s = summarize(
            SEEDS.slice(0, 3).map((seed) =>
              attempt(
                PATIENTS.healthy,
                { view, hand: 'right', noise: NOISE.bench },
                asked,
                reach(
                  PATIENTS.healthy,
                  asked,
                  performed(PATIENTS.healthy, performedPose),
                ),
                seed,
              ),
            ),
          );
          cells[`asked ${asked}`] =
            s.hits === s.runs
              ? 'ACK'
              : s.hits === 0
                ? '-'
                : `${s.hits}/${s.runs}`;
        }
        matrix.push({ performed: performedPose, ...cells });
      }
      report(
        'Confusion matrix: performed pose (rows) vs requested pose (columns), front_upright',
        matrix,
      );
      const cell = (p: PoseId, a: PoseId) =>
        matrix.find((m) => m.performed === p)![`asked ${a}`];
      // The diagonal is always acknowledged.
      for (const p of TENDON) expect(cell(p, p), p).toBe('ACK');
      // Today a hook is accepted as a tabletop and a full fist as a hook: shape is not checked.
      // If a per-joint shape check is added, flip these two expectations.
      expect(cell('hook', 'tabletop')).toBe('ACK');
      expect(cell('full_fist', 'hook')).toBe('ACK');
      // A lighter pose never satisfies a fuller one, and nothing closed satisfies `open`.
      expect(cell('tabletop', 'hook')).toBe('-');
      expect(cell('hook', 'full_fist')).toBe('-');
      for (const p of TENDON.slice(1)) expect(cell(p, 'open'), p).toBe('-');
    });
  },
);
