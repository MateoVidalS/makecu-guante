import { describe, expect, it } from 'vitest';
import type { SessionDetail } from '../contracts/api';
import type { FingerId } from '../contracts/vision';
import { DEFAULT_EXERCISE_SETTINGS } from '../contracts/poses';
import { THERAPY_LIMITS } from '../contracts/therapist';
import { createDemoState } from '../mocks/demo';
import {
  PROGRESSION,
  applyPlan,
  planSummary,
  planToday,
  recentOpeningSessions,
} from './plan';

const FINGERS: FingerId[] = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const settings = DEFAULT_EXERCISE_SETTINGS; // tolerance 0.15, attempt_s 6

/** An opening session where each finger's best closure alone is `closure[finger]`. */
function session(
  id: number,
  closure: Partial<Record<FingerId, number>>,
  options: {
    attempts?: number;
    reachedAlone?: boolean;
    pain?: number;
    direction?: 'open' | 'close';
    demo?: boolean;
  } = {},
): SessionDetail {
  const started = new Date(Date.UTC(2026, 10, id)).toISOString();
  const attempts = Array.from({ length: options.attempts ?? 2 }, (_, i) => ({
    id: id * 100 + i,
    session_id: id,
    pose: 'open' as const,
    rep: i + 1,
    index: i,
    started_at: started,
    ended_at: started,
    reached_active: options.reachedAlone ?? false,
    reached_final: true,
    assisted: !options.reachedAlone,
    time_to_position_s: null,
    active_ratio: 0.5,
    fingers: FINGERS.map((finger) => ({
      finger,
      scored: true,
      target: 0,
      active_max: closure[finger] ?? 0.05,
      assist_needed: 0,
      final: 0,
    })),
    pinch_min: null,
    current_peak_ma: null,
    current_mean_ma: null,
    safety_events: [],
    interrupted: false,
  }));
  return {
    id,
    mode: 'exercise',
    started_at: started,
    ended_at: started,
    calibration_id: 1,
    plan: [{ pose: 'open', reps: attempts.length }],
    settings,
    is_demo: options.demo ?? false,
    summary: null,
    n_attempts: attempts.length,
    assist_direction: options.direction ?? 'open',
    attempts,
    transcript: [],
    feelings:
      options.pain === undefined
        ? []
        : [
            {
              t: started,
              session_id: id,
              attempt_index: null,
              pain: options.pain,
              fatigue: 0,
              note: '',
              source: 'ui',
            },
          ],
  };
}

const plan = (
  history: SessionDetail[],
  challenge: 'gentle' | 'standard' = 'standard',
) => planToday(history, { challenge, settings });
const finger = (p: ReturnType<typeof plan>, f: FingerId) =>
  p.fingers.find((x) => x.finger === f)!;

describe("today's plan", () => {
  it('keeps the standard plan without enough history', () => {
    expect(plan([]).status).toBe('not_enough_data');
    const one = plan([session(1, { index: 0.6 })]);
    expect(one.changed).toBe(false);
    expect(finger(one, 'index').target_scale).toBe(1);
    expect(finger(one, 'index').measured).toBe(false);
    expect(applyPlan(settings, one)).toBe(settings);
  });

  it('sets a weak finger a little beyond what it opens alone', () => {
    // Index opens 40% alone: 0.40 + 0.10 margin + 0.15 tolerance → 0.7 of a full opening.
    const p = plan([session(1, { index: 0.6 }), session(2, { index: 0.6 })]);
    expect(p.status).toBe('adapted');
    expect(finger(p, 'index').opening_alone).toBeCloseTo(0.4);
    expect(finger(p, 'index').target_scale).toBe(0.7);
    // Fingers that reach the full opening alone keep the full target.
    expect(finger(p, 'middle').target_scale).toBe(1);
    expect(finger(p, 'middle').reach_alone_rate).toBe(1);
    // The patient reaches the new target by opening a little more than today's mean.
    const reachedAt = finger(p, 'index').target_scale - settings.tolerance;
    expect(reachedAt).toBeGreaterThan(finger(p, 'index').opening_alone!);
    expect(reachedAt).toBeLessThan(finger(p, 'index').opening_alone! + 0.2);
  });

  it('gentle asks for less, and no plan ever goes past the bounds', () => {
    const history = [session(1, { index: 0.62 }), session(2, { index: 0.62 })];
    expect(finger(plan(history, 'gentle'), 'index').target_scale).toBeLessThan(
      finger(plan(history), 'index').target_scale,
    );
    const stiff = plan([session(1, { index: 1 }), session(2, { index: 1 })]);
    expect(finger(stiff, 'index').target_scale).toBe(PROGRESSION.scaleFloor);
    for (const f of stiff.fingers) {
      expect(f.target_scale).toBeGreaterThanOrEqual(
        THERAPY_LIMITS.target_scale[0],
      );
      expect(f.target_scale).toBeLessThanOrEqual(1);
    }
  });

  it('gives more time to try alone as openings succeed alone (help fades)', () => {
    const doingWell = [
      session(1, {}, { reachedAlone: true }),
      session(2, {}, { reachedAlone: true }),
    ];
    expect(plan(doingWell).attempt_s).toBe(8);
    expect(plan(doingWell, 'gentle').attempt_s).toBe(7);
    expect(plan(doingWell).attempt_reason).toContain('8 s instead of 6 s');
    const struggling = [session(1, { index: 0.7 }), session(2, { index: 0.7 })];
    expect(plan(struggling).attempt_s).toBe(6);
    expect(plan(doingWell).attempt_s).toBeLessThanOrEqual(
      THERAPY_LIMITS.attempt_s[1],
    );
  });

  it('pain reported last session keeps the standard trying time', () => {
    const p = plan([
      session(1, {}, { reachedAlone: true }),
      session(2, {}, { reachedAlone: true, pain: 3 }),
    ]);
    expect(p.attempt_s).toBe(6);
    expect(p.attempt_reason).toContain('pain');
  });

  it('uses only the last three completed opening sessions', () => {
    const old = [1, 2, 3].map((id) => session(id, { index: 0.9 }));
    const recent = [4, 5, 6].map((id) => session(id, { index: 0.1 }));
    const legacy = session(7, { index: 0.9 }, { direction: 'close' });
    const unfinished = { ...session(8, { index: 0.9 }), ended_at: null };
    const p = plan([...old, ...recent, legacy, unfinished]);
    expect(p.sessions).toEqual([6, 5, 4]);
    expect(finger(p, 'index').target_scale).toBe(1);
    expect(recentOpeningSessions([legacy, unfinished])).toEqual([]);
  });

  it('applies to settings only when something changed, never shortening the try', () => {
    const p = plan([session(1, { index: 0.6 }), session(2, { index: 0.6 })]);
    const applied = applyPlan(settings, p);
    expect(applied).not.toBe(settings);
    expect(applied).toMatchObject({
      attempt_s: 6,
      progression: { target_scale: { index: 0.7 }, sessions: [2, 1] },
    });
    expect(planSummary(p)).toContain('index 70% of a full opening');
    expect(applyPlan(settings, null)).toBe(settings);
    expect(applyPlan({ ...settings, attempt_s: 9 }, p).attempt_s).toBe(9);
  });

  it('gives the seeded demo patient a sensible plan', () => {
    const demo = createDemoState('2026-11-08T12:00:00.000Z');
    const p = plan(Object.values(demo.details));
    expect(p.sessions).toHaveLength(PROGRESSION.window);
    expect(p.is_demo).toBe(true);
    expect(p.fingers.every((f) => f.measured)).toBe(true);
    for (const f of p.fingers) {
      expect(f.target_scale).toBeGreaterThanOrEqual(PROGRESSION.scaleFloor);
      expect(f.target_scale).toBeLessThanOrEqual(1);
    }
    expect(p.attempt_s).toBeGreaterThanOrEqual(settings.attempt_s);
  });
});
