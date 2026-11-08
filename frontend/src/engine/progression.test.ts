// Today's plan inside the engine (docs/plan/17-progression.md): only easier targets and more
// time to try alone, clamped to THERAPY_LIMITS, audited, and adjustable by the coach.
import { describe, expect, it } from 'vitest';
import type { ExercisePlanItem } from '../contracts/engine';
import { DEFAULT_EXERCISE_SETTINGS, MAX_ASSIST_PULL } from '../contracts/poses';
import { THERAPY_LIMITS } from '../contracts/therapist';
import { createExerciseEngine } from './exercise';
import type { GloveCommand, Output, ProgressionStart } from './types';
import { calibration, FakeWorld } from './test/fakeWorld';

const plan: ExercisePlanItem[] = [{ pose: 'open', reps: 2 }];

function run(progression?: ProgressionStart, attempt_s = 4) {
  const world = new FakeWorld();
  // A relaxed, curled hand that does not open alone: every finger needs help.
  world.hand = [0.8, 0.8, 0.8, 0.8, 0.8];
  const sent: GloveCommand[] = [];
  const accept = (out: Output) => {
    sent.push(...out.commands);
    world.apply(out.commands);
  };
  const engine = createExerciseEngine({
    onTherapyOutput: accept,
    therapy: { sessionId: () => 7 },
  });
  accept(
    engine.start(
      plan,
      {
        ...DEFAULT_EXERCISE_SETTINGS,
        help_on_request: false,
        present_s: 0,
        attempt_s,
        hold_s: 0.1,
        rest_s: 0.1,
        assist_max_s: 2,
        plateau_s: 99,
        ...(progression ? { progression } : {}),
      },
      calibration,
      0,
    ),
  );
  const tick = (ms = 50) => accept(engine.tick(world.step(ms)));
  return { engine, sent, tick };
}

const start = (
  overrides: Partial<ProgressionStart> = {},
): ProgressionStart => ({
  target_scale: { index: 0.7 },
  attempt_s: 4,
  challenge: 'standard',
  sessions: [12, 11, 10],
  summary:
    "Today's plan from 3 recent sessions (standard): index 70% of a full opening.",
  ...overrides,
});

describe("today's plan in the therapy controller", () => {
  it('changes nothing and logs nothing without a plan (the default practice)', () => {
    const { engine } = run();
    const adjustments = engine.therapy.current();
    expect(Object.values(adjustments.target_scale)).toEqual([1, 1, 1, 1, 1]);
    expect(adjustments.attempt_s).toBe(4);
    expect(engine.therapy.decisions()).toEqual([]);
  });

  it('starts from the planned targets and logs one audited local-rule decision', () => {
    const { engine, tick } = run(start());
    expect(engine.therapy.current().target_scale.index).toBe(0.7);
    expect(engine.therapy.current().target_scale.middle).toBe(1);
    const [decision] = engine.therapy.decisions();
    expect(decision).toMatchObject({
      tool: 'progression_plan',
      source: 'local_rule',
      result: 'applied',
      applied: { target_scale: { index: 0.7 }, attempt_s: 4 },
      requested: { sessions: [12, 11, 10], challenge: 'standard' },
    });
    expect(decision.reason).toContain('index 70%');
    // The open pose asks the index to open 70%: closure target 0.3 instead of 0.
    for (let i = 0; i < 40 && engine.state().phase !== 'ATTEMPT'; i++) tick();
    expect(engine.state().phase).toBe('ATTEMPT');
    expect(engine.poseDef().closure.index).toBeCloseTo(0.3);
    expect(engine.poseDef().closure.middle).toBe(0);
  });

  it('never makes practice harder or leaves THERAPY_LIMITS', () => {
    const { engine } = run(
      start({
        target_scale: { index: 1.4, thumb: 0.2, ring: Number.NaN },
        attempt_s: 30,
      }),
    );
    const adjustments = engine.therapy.current();
    expect(adjustments.target_scale.index).toBe(1);
    expect(adjustments.target_scale.thumb).toBe(THERAPY_LIMITS.target_scale[0]);
    expect(adjustments.target_scale.ring).toBe(1);
    expect(adjustments.attempt_s).toBe(THERAPY_LIMITS.attempt_s[1]);
    expect(engine.therapy.decisions()[0].result).toBe('clamped');
    // A shorter planned time never shortens today's trying time either.
    const shorter = run(start({ attempt_s: 2 }), 6);
    expect(shorter.engine.therapy.current().attempt_s).toBe(6);
  });

  it('a lower target also lowers how far the glove pulls the finger', () => {
    const maxIndexPull = (sent: GloveCommand[]) =>
      Math.max(0, ...sent.flatMap((c) => (c.t === 'target' ? [c.f[1]] : [])));
    const standard = run();
    const planned = run(start());
    for (let i = 0; i < 200; i++) {
      standard.tick();
      planned.tick();
    }
    const full = maxIndexPull(standard.sent);
    const eased = maxIndexPull(planned.sent);
    expect(full).toBeGreaterThan(0);
    expect(full).toBeLessThanOrEqual(MAX_ASSIST_PULL + 1e-9);
    expect(eased).toBeGreaterThan(0);
    expect(eased).toBeLessThan(full - 0.1);
  });

  it('the coach still adjusts from the plan, within the same bounds', () => {
    const { engine, tick } = run(start());
    for (let i = 0; i < 40 && engine.state().phase !== 'ATTEMPT'; i++) tick();
    const raised = engine.therapy.adjust(
      'adjust_target',
      { finger: 'index', direction: 'raise', reason: 'You are opening well' },
      'coach',
    );
    expect(raised.applied).toMatchObject({ target_scale: 0.8 });
    const middle = engine.therapy.adjust(
      'adjust_target',
      { finger: 'middle', direction: 'raise', reason: 'You are opening well' },
      'coach',
    );
    // Already at the full target: raising cannot go past it.
    expect(middle.result).toBe('clamped');
    expect(middle.applied).toMatchObject({ target_scale: 1 });
  });
});
