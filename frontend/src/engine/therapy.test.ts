import { describe, expect, it, vi } from 'vitest';
import type { CoachToolName } from '../contracts/therapist';
import type { ExerciseSettings, ExercisePlanItem } from '../contracts/engine';
import { GLOVE_FINGERS } from '../contracts/glove';
import {
  DEFAULT_EXERCISE_SETTINGS,
  MAX_ASSIST_CLOSURE,
} from '../contracts/poses';
import { createExerciseEngine } from './exercise';
import type { GloveCommand, Output } from './types';
import { calibration, FakeWorld } from './test/fakeWorld';

function harness(
  settings: Partial<ExerciseSettings> = {},
  plan: ExercisePlanItem[] = [
    { pose: 'full_fist', reps: 3 },
    { pose: 'hook', reps: 1 },
  ],
) {
  const world = new FakeWorld();
  const outputs: Output[] = [];
  const sentCommands: GloveCommand[] = [];
  const accept = (out: Output) => {
    outputs.push(out);
    sentCommands.push(...out.commands);
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
        present_s: 0,
        attempt_s: 1,
        hold_s: 0.1,
        rest_s: 0.1,
        assist_max_s: 0.5,
        plateau_s: 99,
        ...settings,
      },
      calibration,
      0,
    ),
  );
  const tick = (ms = 50) => accept(engine.tick(world.step(ms)));
  const until = (predicate: () => boolean) => {
    for (let i = 0; i < 4000 && !predicate(); i++) tick();
    expect(predicate()).toBe(true);
  };
  const call = (tool: CoachToolName, args: Record<string, unknown> = {}) =>
    engine.therapy.adjust(tool, args, 'coach');
  const commands = () => sentCommands;
  return {
    world,
    engine,
    therapy: engine.therapy,
    outputs,
    tick,
    until,
    call,
    commands,
  };
}

describe('therapy engine policy and boundaries', () => {
  it('changes attempt time only at the next ATTEMPT and reports its actual duration', () => {
    const h = harness();
    h.until(() => h.engine.state().phase === 'ATTEMPT');
    expect(
      h.call('set_attempt_time', { seconds: 99, reason: 'More time to try.' }),
    ).toMatchObject({ result: 'clamped', applied: { seconds: 9 } });
    expect(h.engine.phaseDuration()).toBe(1);
    h.until(
      () =>
        h.engine.state().index === 1 && h.engine.state().phase === 'ATTEMPT',
    );
    expect(h.engine.phaseDuration()).toBe(9);
    h.tick(4000);
    expect(h.engine.state().phase).toBe('ATTEMPT');
  });

  it('applies extra rest once, bounds cumulative rest to 60 seconds and does not refund consumed rest', () => {
    const h = harness();
    for (let i = 0; i < 3; i++)
      expect(
        h.call('add_rest', { seconds: 80, reason: 'Take a rest.' }).applied,
      ).toMatchObject({ seconds: 20 });
    expect(h.call('add_rest', { seconds: 1, reason: 'Rest.' }).result).toBe(
      'rejected',
    );
    h.until(() => h.engine.state().phase === 'REST');
    expect(h.engine.phaseDuration()).toBe(60.1);
    h.therapy.undo();
    expect(h.engine.phaseDuration()).toBe(60.1);
    h.until(
      () => h.engine.state().index === 1 && h.engine.state().phase === 'REST',
    );
    expect(h.engine.phaseDuration()).toBe(0.1);
    expect(h.call('add_rest', { seconds: 1, reason: 'Rest.' }).result).toBe(
      'rejected',
    );
  });

  it('undoes queued rest without changing the current rest boundary', () => {
    const h = harness();
    h.until(() => h.engine.state().phase === 'REST');
    h.call('add_rest', {
      seconds: 10,
      reason: 'Rest before the following pose.',
    });
    h.therapy.undo();
    h.until(
      () => h.engine.state().index === 1 && h.engine.state().phase === 'REST',
    );
    expect(h.engine.phaseDuration()).toBe(0.1);
  });

  it('overrides exactly the next plan slot without changing plan length or repetitions', () => {
    const h = harness();
    expect(
      h.call('choose_next_pose', { pose: 'pinch', reason: 'Try pinch.' })
        .result,
    ).toBe('rejected');
    expect(
      h.call('choose_next_pose', { pose: 'tabletop', reason: 'Try tabletop.' })
        .result,
    ).toBe('rejected');
    h.call('choose_next_pose', { pose: 'hook', reason: 'Try a hook next.' });
    expect(h.engine.state().pose).toBe('full_fist');
    h.until(() => h.engine.state().index === 1);
    expect(h.engine.state()).toMatchObject({ pose: 'hook', total: 4, rep: 2 });
    h.until(() => h.engine.state().index === 2);
    expect(h.engine.state().pose).toBe('full_fist');
    h.until(() => h.engine.state().index === 3);
    expect(
      h.call('choose_next_pose', { pose: 'hook', reason: 'Another hook.' })
        .result,
    ).toBe('rejected');
  });

  it('makes help gentler immediately without starting another finger, and stages undo until the next boundary', () => {
    const h = harness({ assist_max_s: 2 });
    h.until(() => h.engine.state().phase === 'ASSIST');
    const target = h
      .commands()
      .filter((c) => c.t === 'target')
      .at(-1)!;
    const count = h.commands().length;
    const lower = h.call('adjust_help', {
      finger: 'all',
      direction: 'gentler',
      reason: 'Gentler help.',
    });
    expect(lower.result).toBe('applied');
    expect(h.commands().slice(count)).toEqual([{ ...target, v: 0.15 }]);
    expect(
      h.call('adjust_help', {
        finger: 'index',
        direction: 'gentler',
        reason: 'Less.',
      }).result,
    ).toBe('rejected');
    const beforeUndo = h.commands().length;
    expect(h.therapy.undo()?.result).toBe('undone');
    expect(h.commands()).toHaveLength(beforeUndo);
    expect(h.therapy.current().assist_speed.index).toBe(0.15);
    h.until(
      () => h.engine.state().index === 1 && h.engine.state().phase === 'ASSIST',
    );
    expect(h.therapy.current().assist_speed.index).toBe(0.2);
    expect(
      h.call('adjust_help', {
        finger: 'index',
        direction: 'gentler',
        reason: 'Less.',
      }).result,
    ).toBe('applied');
  });

  it('queues sooner help until ATTEMPT and atomically rejects overlapping all-finger adjustments', () => {
    const h = harness({ attempt_s: 6 });
    h.call('adjust_help', {
      finger: 'index',
      direction: 'less',
      reason: 'More time alone.',
    });
    expect(
      h.call('adjust_help', {
        finger: 'all',
        direction: 'more',
        reason: 'Help sooner.',
      }).result,
    ).toBe('rejected');
    expect(h.therapy.current().assist_delay_s.index).toBe(7);
    expect(h.therapy.state()?.adjustments.assist_speed.middle).toBe(0.2);
    h.until(
      () =>
        h.engine.state().index === 1 && h.engine.state().phase === 'ATTEMPT',
    );
    h.call('adjust_help', {
      finger: 'index',
      direction: 'more',
      reason: 'Help the tired finger sooner.',
    });
    expect(h.therapy.current().assist_delay_s.index).toBe(7);
    expect(h.therapy.state()?.adjustments.assist_delay_s.index).toBe(6);
    expect(h.therapy.current().assist_speed.index).toBe(0.2);
    h.until(
      () =>
        h.engine.state().index === 2 && h.engine.state().phase === 'ATTEMPT',
    );
    expect(h.therapy.current().assist_delay_s.index).toBe(6);
  });

  it('brakes before notifying observers, records coach_brake, and cannot undo a brake or resume by adjustment', () => {
    const h = harness();
    h.until(() => h.engine.state().phase === 'ASSIST');
    let observed = false;
    h.therapy.onDecision((d) => {
      if (d.tool === 'brake') {
        expect(h.world.tel.md).toBe('none');
        expect(h.engine.state().phase).toBe('PAUSED');
        observed = true;
      }
    });
    const before = h.commands().length;
    const brake = h.call('brake', { reason: 'Stop now.', force: 999 });
    expect(brake.requested).toEqual({ reason: 'Stop now.', force: 999 });
    expect(observed).toBe(true);
    expect(h.commands().slice(before)).toEqual([{ t: 'release' }]);
    expect(h.therapy.undo()).toBeNull();
    expect(
      h.call('set_attempt_time', { seconds: 8, reason: 'Wait.' }).result,
    ).toBe('rejected');
    h.tick(5000);
    expect(h.engine.state().phase).toBe('PAUSED');
    h.world.apply(h.engine.resume(h.world.now).commands);
    h.until(() => h.engine.state().phase === 'REST');
    const attempt = h.outputs
      .flatMap((o) => o.events)
      .find((e) => e.kind === 'attempt_done');
    expect(attempt).toMatchObject({
      result: { interrupted: true, safety_events: [{ source: 'coach_brake' }] },
    });
  });

  it('brakes deterministically at pain 4, stores feeling while paused, and brakes on malformed high-pain payloads', () => {
    const h = harness();
    h.until(() => h.engine.state().phase === 'ATTEMPT');
    expect(
      h.therapy.recordFeeling({
        pain: 3,
        fatigue: 6,
        note: 'Tired.',
        source: 'ui',
      }).result,
    ).toBe('applied');
    expect(h.engine.state().phase).toBe('ATTEMPT');
    h.therapy.recordFeeling({
      pain: 4,
      fatigue: 6,
      note: 'Hurts.',
      source: 'voice',
    });
    expect(h.engine.state().phase).toBe('PAUSED');
    expect(h.therapy.feelings()).toHaveLength(2);
    expect(h.therapy.feelings().at(-1)).toMatchObject({
      session_id: 7,
      attempt_index: 0,
      pain: 4,
      source: 'voice',
    });
    expect(h.therapy.decisions().at(-2)).toMatchObject({
      tool: 'brake',
      source: 'local_rule',
    });
    const before = h.commands().length;
    expect(
      h.call('record_feeling', { pain: 5, fatigue: 'bad', note: 'Pain.' })
        .result,
    ).toBe('rejected');
    expect(h.commands().slice(before)).toEqual([{ t: 'release' }]);
    expect(h.therapy.feelings()).toHaveLength(2);
    h.tick(60_000);
    expect(h.therapy.state()?.last_feeling?.minutes_ago).toBe(1);
  });

  it('gives distinct reports unique timestamps even within one millisecond', () => {
    const h = harness();
    h.until(() => h.engine.state().phase === 'ATTEMPT');
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    h.therapy.recordFeeling({
      pain: 1,
      fatigue: 2,
      note: 'First.',
      source: 'ui',
    });
    h.therapy.recordFeeling({
      pain: 2,
      fatigue: 3,
      note: 'Second.',
      source: 'ui',
    });
    const [first, second] = h.therapy.feelings();
    expect(Date.parse(second.t) - Date.parse(first.t)).toBe(1);
  });

  it('exposes five fingers, best alone, lagging, help, last result and unavailable vision accurately', () => {
    const h = harness();
    h.world.hand = [0.4, 0.1, 0.4, 0.4, 0.4];
    h.until(() => h.engine.state().phase === 'ATTEMPT');
    const state = h.therapy.state()!;
    expect(state.fingers).toHaveLength(5);
    expect(state.fingers.filter((f) => f.lagging).map((f) => f.finger)).toEqual(
      ['index'],
    );
    expect(state.fingers[1]).toMatchObject({
      now: 0.1,
      best_alone: 0.1,
      glove_helping: false,
    });
    h.until(() => h.engine.state().phase === 'ASSIST');
    expect(h.therapy.state()?.fingers[1].glove_helping).toBe(true);
    h.world.confidence = 0;
    h.tick();
    expect(
      h.therapy.state()?.fingers.every((f) => f.now === null && !f.lagging),
    ).toBe(true);
    h.world.confidence = 1;
    h.until(() => h.engine.state().phase === 'REST');
    expect(h.therapy.state()?.last_attempt).toMatchObject({
      reached_alone: false,
      assisted: true,
    });
  });

  it('rejects malformed tools and keeps caller mutations away from limits, settings and audit records', () => {
    const h = harness();
    const mutate = h.therapy.limits;
    mutate.assist_speed[1] = 100;
    mutate.pain_brake_at = 99;
    expect(h.therapy.limits.assist_speed[1]).toBe(0.2);
    const bad: [CoachToolName, Record<string, unknown>][] = [
      ['adjust_help', { finger: 'elbow', direction: 'more' }],
      ['adjust_help', { finger: 'index', direction: 'up' }],
      ['set_attempt_time', { seconds: NaN }],
      ['set_attempt_time', { seconds: Infinity }],
      ['add_rest', { seconds: -1 }],
      ['add_rest', { seconds: '20' }],
      ['choose_next_pose', { pose: '__proto__' }],
      ['unknown' as CoachToolName, {}],
    ];
    for (const [tool, args] of bad)
      expect(h.call(tool, { ...args, reason: 'Check.' }).result).toBe(
        'rejected',
      );
    const requested = { seconds: 8, reason: 'Try longer.' };
    const d = h.call('set_attempt_time', requested);
    requested.seconds = 200;
    d.requested.seconds = 300;
    const copy = h.therapy.decisions();
    copy.at(-1)!.requested.seconds = 400;
    h.therapy.state()!.adjustments.assist_speed.index = 100;
    expect(h.therapy.decisions().at(-1)?.requested.seconds).toBe(8);
    expect(h.therapy.state()?.adjustments.assist_speed.index).toBe(0.2);
  });

  it('always releases even without an active session and resets overrides and audit for a new session', () => {
    const outputs: Output[] = [];
    const engine = createExerciseEngine({
      onTherapyOutput: (out) => outputs.push(out),
    });
    expect(engine.therapy.state()).toBeNull();
    engine.therapy.brake('Stop.', 'patient_ui');
    expect(outputs.flatMap((out) => out.commands)).toEqual([{ t: 'release' }]);
    expect(
      engine.therapy.adjust(
        'add_rest',
        { seconds: 2, reason: 'Rest.' },
        'coach',
      ).result,
    ).toBe('rejected');
    engine.start(
      [{ pose: 'hook', reps: 1 }],
      DEFAULT_EXERCISE_SETTINGS,
      calibration,
      0,
    );
    expect(engine.therapy.decisions()).toEqual([]);
    expect(engine.therapy.state()?.adjustments.attempt_s).toBe(6);
  });
});

describe('approved therapy tools and gentleness policy', () => {
  it('more starts help sooner for one finger while other fingers keep trying alone', () => {
    const h = harness({ attempt_s: 6, assist_max_s: 6 });
    h.call('adjust_help', {
      finger: 'thumb',
      direction: 'more',
      reason: 'Start help sooner.',
    });
    expect(h.therapy.current().assist_delay_s.thumb).toBe(6);
    h.until(() => h.engine.state().phase === 'ATTEMPT');
    expect(h.therapy.current().assist_delay_s.thumb).toBe(5);
    h.tick(4900);
    expect(h.commands().filter((c) => c.t === 'target')).toHaveLength(0);
    h.tick(100);
    expect(h.engine.state().phase).toBe('ATTEMPT');
    expect(h.commands().at(-1)).toMatchObject({
      t: 'target',
      f: [0.7, 0, 0, 0, 0],
      v: 0.2,
    });
    expect(h.therapy.state()?.fingers.map((f) => f.glove_helping)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
    h.world.hand = [0.5, 0.3, 0.3, 0.3, 0.3];
    h.tick();
    expect(h.therapy.state()?.fingers[0].best_alone).toBe(0);
    expect(h.therapy.state()?.fingers[1].best_alone).toBe(0.3);
  });

  it('less cancels a currently early-assisted finger until its later delay', () => {
    const h = harness({ attempt_s: 6, assist_max_s: 6 });
    h.call('adjust_help', {
      finger: 'thumb',
      direction: 'more',
      reason: 'Earlier.',
    });
    h.until(
      () =>
        h.engine.state().index === 1 && h.engine.state().phase === 'ATTEMPT',
    );
    h.tick(5000);
    expect(h.therapy.state()?.fingers[0].glove_helping).toBe(true);
    const before = h.commands().length;
    h.call('adjust_help', {
      finger: 'thumb',
      direction: 'less',
      reason: 'Wait longer.',
    });
    expect(h.therapy.current().assist_delay_s.thumb).toBe(6);
    expect(h.therapy.state()?.fingers[0].glove_helping).toBe(false);
    expect(
      h
        .commands()
        .slice(before)
        .every((c) => c.t === 'target' && c.f[0] <= h.world.tel.a[0]),
    ).toBe(true);
  });

  it('immediate finger requests obey the stagger and three-motor cap during ATTEMPT', () => {
    const h = harness({ attempt_s: 9, assist_max_s: 6 });
    expect(
      h.call('assist_finger_now', { finger: 'thumb', reason: 'Help now.' })
        .result,
    ).toBe('rejected');
    h.until(() => h.engine.state().phase === 'ATTEMPT');
    for (const finger of GLOVE_FINGERS)
      expect(
        h.call('assist_finger_now', { finger, reason: 'Help now.' }).result,
      ).toBe('applied');
    expect(h.engine.state().phase).toBe('ATTEMPT');
    expect(h.commands().filter((c) => c.t === 'target')).toHaveLength(1);
    for (let i = 0; i < 25; i++) {
      h.tick(50);
      expect(
        h.world.tel.a.filter((a, j) => Math.abs(a - h.world.tel.tg![j]) > 1e-6)
          .length,
      ).toBeLessThanOrEqual(3);
    }
    expect(h.commands().filter((c) => c.t === 'target').length).toBe(3);
    expect(
      h.call('assist_finger_now', { finger: 'thumb', reason: 'Again.' }).result,
    ).toBe('rejected');
    h.until(() => h.engine.state().phase === 'ASSIST_HOLD');
    expect(h.engine.state().phaseElapsed).toBe(0);
  });

  it('refuses immediate assistance with disabled assistance, missing vision or unsafe telemetry', () => {
    for (const mode of ['disabled', 'vision', 'fault', 'current'] as const) {
      const h = harness({ attempt_s: 6, assist_enabled: mode !== 'disabled' });
      h.until(() => h.engine.state().phase === 'ATTEMPT');
      if (mode === 'vision') {
        h.world.confidence = 0;
        h.tick();
      }
      if (mode === 'fault') {
        h.world.tel.st = 'fault';
        h.tick();
      }
      if (mode === 'current') {
        h.world.ma = calibration.current_limit_ma;
        h.tick();
      }
      const before = h.commands().length;
      expect(
        h.call('assist_finger_now', { finger: 'index', reason: 'Help.' })
          .result,
      ).toBe('rejected');
      expect(h.commands()).toHaveLength(before);
    }
  });

  it('does not count a manually assisted finger as alone and gates its vision loss like ASSIST', () => {
    const h = harness({ attempt_s: 6 });
    h.world.hand = [0.1, 0.1, 0.1, 0.1, 0.1];
    h.until(() => h.engine.state().phase === 'ATTEMPT');
    h.call('assist_finger_now', {
      finger: 'index',
      reason: 'Help this finger.',
    });
    h.world.hand = [0.3, 0.9, 0.3, 0.3, 0.3];
    h.tick();
    expect(h.therapy.state()?.fingers[1].best_alone).toBe(0.1);
    expect(h.therapy.state()?.fingers[2].best_alone).toBe(0.3);
    h.world.confidence = 0;
    h.tick();
    h.tick(300);
    expect(h.world.tel.md).toBe('none');
    h.tick(700);
    expect(h.engine.state().phase).toBe('PAUSED');
    expect(h.therapy.state()?.last_safety).toMatchObject({
      source: 'camera_lost',
    });
  });

  it('undo cancels an immediate-help request at the next boundary without adding a pull', () => {
    const h = harness({ attempt_s: 1, assist_max_s: 6 });
    h.until(() => h.engine.state().phase === 'ATTEMPT');
    h.call('assist_finger_now', { finger: 'thumb', reason: 'Help now.' });
    h.therapy.undo();
    expect(h.therapy.state()?.fingers[0].glove_helping).toBe(true);
    h.until(() => h.engine.state().phase === 'ASSIST');
    expect(h.therapy.state()?.fingers[0].glove_helping).toBe(false);
    expect(h.commands().at(-1)).toMatchObject({ t: 'target' });
  });

  it('shapes targets and joint rendering only at ATTEMPT and clamps scale to half through full range', () => {
    const h = harness({}, [{ pose: 'full_fist', reps: 8 }]);
    h.call('adjust_target', {
      finger: 'index',
      direction: 'lower',
      reason: 'An easier goal.',
    });
    expect(h.engine.poseDef().closure.index).toBe(0.95);
    h.until(() => h.engine.state().phase === 'ATTEMPT');
    expect(h.engine.poseDef().closure.index).toBeCloseTo(0.855);
    expect(h.engine.poseDef().render.index.pip).toBe(90);
    expect(
      h.call('adjust_target', {
        finger: 'index',
        direction: 'raise',
        reason: 'Raise.',
      }).result,
    ).toBe('rejected');
    for (let index = 1; index <= 5; index++) {
      h.until(
        () =>
          h.engine.state().index === index &&
          h.engine.state().phase === 'ATTEMPT',
      );
      const d = h.call('adjust_target', {
        finger: 'index',
        direction: 'lower',
        reason: 'Easier.',
      });
      if (index === 5) expect(d.result).toBe('clamped');
    }
    expect(h.therapy.state()?.adjustments.target_scale.index).toBe(0.5);
    h.until(
      () =>
        h.engine.state().index === 6 && h.engine.state().phase === 'ATTEMPT',
    );
    expect(h.engine.poseDef().closure.index).toBeCloseTo(0.475);
  });

  it('highlights expire after four seconds and clinical notes remain in the audit without motor commands', () => {
    const h = harness({ attempt_s: 9, assist_enabled: false });
    h.until(() => h.engine.state().phase === 'ATTEMPT');
    const before = h.commands().length;
    h.call('highlight_finger', { finger: 'pinky' });
    h.call('note_for_therapist', {
      text: ' Reports tingling in the little finger. ',
    });
    expect(h.commands()).toHaveLength(before);
    expect(h.therapy.decisions().at(-1)?.applied).toEqual({
      text: 'Reports tingling in the little finger.',
    });
    expect(h.therapy.state()?.highlighted_finger).toBe('pinky');
    h.tick(3999);
    expect(h.therapy.state()?.highlighted_finger).toBe('pinky');
    h.tick(1);
    expect(h.therapy.state()?.highlighted_finger).toBeNull();
    expect(h.call('highlight_finger', { finger: 'elbow' }).result).toBe(
      'rejected',
    );
    expect(h.call('note_for_therapist', { text: '' }).result).toBe('rejected');
  });

  it('limits repeats to three, undoes queued repeats, and preserves completed repetitions', () => {
    const h = harness({}, [{ pose: 'full_fist', reps: 1 }]);
    for (let i = 0; i < 3; i++)
      expect(
        h.call('repeat_pose', { reason: 'Practice this again.' }).result,
      ).toBe('applied');
    expect(h.call('repeat_pose', { reason: 'One more.' }).result).toBe(
      'rejected',
    );
    h.therapy.undo();
    h.until(() => h.engine.state().phase === 'DONE');
    expect(h.engine.state().total).toBe(3);
    const attempts = h.outputs
      .flatMap((out) => out.events)
      .filter((e) => e.kind === 'attempt_done');
    expect(attempts).toHaveLength(3);
    expect(attempts.map((e) => e.result.rep)).toEqual([1, 2, 3]);
  });

  it('automatic resistance lowering cannot be undone above the new safety ceiling', () => {
    const h = harness();
    h.call('adjust_help', {
      finger: 'index',
      direction: 'gentler',
      reason: 'Gentle.',
    });
    h.therapy.resistance('index');
    expect(h.therapy.current().assist_speed.index).toBe(0.1);
    h.therapy.undo();
    h.until(() => h.engine.state().phase === 'ASSIST');
    expect(h.therapy.current().assist_speed.index).toBe(0.1);
    expect(h.therapy.decisions()).toContainEqual(
      expect.objectContaining({
        source: 'local_rule',
        applied: expect.objectContaining({ automatic: true }),
      }),
    );
  });

  it('keeps session controls available and audits them before stopping the session', () => {
    const h = harness({ attempt_s: 6 });
    h.until(() => h.engine.state().phase === 'ATTEMPT');
    h.call('pause_session');
    expect(h.engine.state().phase).toBe('PAUSED');
    h.call('resume_session');
    expect(h.engine.state().phase).toBe('RELEASE');
    expect(h.commands().at(-1)).toEqual({ t: 'release' });
    expect(h.call('get_progress').applied).toMatchObject({
      index: 0,
      total: 4,
    });
    expect(h.call('repeat_instruction').applied).toMatchObject({
      instruction: 'Make a full fist',
    });
    h.call('stop_session');
    expect(h.engine.state().phase).toBe('DONE');
    expect(h.therapy.decisions().at(-1)?.tool).toBe('stop_session');
  });
});

describe('patient-requested intensity and consent boundaries', () => {
  const consent = (
    h: ReturnType<typeof harness>,
    kind: 'faster' | 'further' | 'hold_longer',
    finger = 'index',
  ) => {
    h.therapy.notePatientSpeech('Yes, please.');
    return h.call('intensify', {
      finger,
      kind,
      consent: 'accepted_offer',
      patient_quote: 'Yes, please.',
    });
  };

  it('rejects fabricated, stale, future-dated, negative or unrelated patient consent', () => {
    for (const scenario of [
      'absent',
      'stale',
      'future',
      'mismatch',
      'no',
      'unrelated',
    ] as const) {
      const h = harness({ present_s: 100 });
      const quote =
        scenario === 'no'
          ? 'No, not faster.'
          : scenario === 'unrelated'
            ? 'The weather is okay.'
            : 'Yes, please.';
      if (scenario === 'stale') {
        h.therapy.notePatientSpeech(quote);
        h.tick(20_001);
      } else if (scenario === 'future')
        h.therapy.notePatientSpeech(quote, h.world.now + 1000);
      else if (scenario !== 'absent')
        h.therapy.notePatientSpeech(
          scenario === 'mismatch' ? 'Other words.' : quote,
        );
      expect(
        h.call('intensify', {
          finger: 'index',
          kind: 'faster',
          consent: 'accepted_offer',
          patient_quote: quote,
        }).result,
      ).toBe('rejected');
      expect(h.therapy.state()?.adjustments.intensified).toEqual([]);
      expect(h.commands().some((c) => c.t === 'target')).toBe(false);
    }
  });

  it('expires pending consent if the next ATTEMPT starts after the consent window', () => {
    const h = harness({ present_s: 30 });
    expect(consent(h, 'faster').result).toBe('applied');
    h.tick(1000);
    h.tick(30_000);
    expect(h.engine.state().phase).toBe('ATTEMPT');
    expect(h.therapy.current().assist_speed.index).toBe(0.2);
    expect(h.therapy.state()?.adjustments.intensified).toEqual([]);
    expect(h.therapy.decisions().at(-1)).toMatchObject({
      tool: 'intensify',
      result: 'undone',
      source: 'local_rule',
      applied: { auto_reverted: true },
    });
  });

  it('allows 0.30/s only after actual patient speech and the next ATTEMPT', () => {
    const h = harness({ assist_max_s: 6 });
    h.therapy.notePatientSpeech('Please go faster.');
    const d = h.call('intensify', {
      finger: 'index',
      kind: 'faster',
      consent: 'patient_asked',
      patient_quote: 'Please go faster.',
      speed: 99,
      current_limit_ma: 9999,
    });
    expect(d.result).toBe('applied');
    expect(d.requested.patient_quote).toBe('Please go faster.');
    expect(h.therapy.current().assist_speed.index).toBe(0.2);
    h.until(() => h.engine.state().phase === 'ATTEMPT');
    expect(h.therapy.current().assist_speed.index).toBe(0.3);
    h.until(() => h.engine.state().phase === 'ASSIST');
    expect(h.commands().filter((c) => c.t === 'target')[0]).toMatchObject({
      v: 0.3,
    });
    expect(h.commands().every((c) => c.t !== 'limit')).toBe(true);
  });

  it('allows the approved patient-requested cap independently of baseline gentleness', () => {
    const h = harness({ assist_speed: 0.15 });
    expect(consent(h, 'faster').result).toBe('applied');
    h.until(() => h.engine.state().phase === 'ATTEMPT');
    expect(h.therapy.current().assist_speed.index).toBe(0.3);
  });

  it('reaches the calibrated range only for the consented finger, never for raw target arguments', () => {
    const h = harness({ assist_max_s: 6 });
    h.therapy.notePatientSpeech('Close further please.');
    h.call('intensify', {
      finger: 'index',
      kind: 'further',
      consent: 'patient_asked',
      patient_quote: 'Close further please.',
      target: 999,
    });
    expect(h.engine.poseDef().closure.index).toBe(0.95);
    h.until(() => h.engine.state().phase === 'ATTEMPT');
    expect(h.engine.poseDef().closure.index).toBe(1);
    expect(h.engine.poseDef().closure.middle).toBe(0.95);
    h.until(() => h.engine.state().phase === 'ASSIST');
    const target = h.commands().filter((c) => c.t === 'target')[0];
    expect(target).toMatchObject({ f: [0, 1, 0, 0, 0], v: 0.2 });
    expect(
      h
        .commands()
        .filter((c) => c.t === 'target')
        .every((c) => c.f.every((f) => f >= 0 && f <= 1)),
    ).toBe(true);
  });

  it('adds at most two seconds to hold and applies it at the next ATTEMPT', () => {
    const h = harness({ hold_s: 2 });
    expect(consent(h, 'hold_longer').result).toBe('applied');
    expect(h.therapy.holdSeconds(2)).toBe(2);
    h.until(() => h.engine.state().phase === 'ATTEMPT');
    expect(h.therapy.holdSeconds(2)).toBe(4);
    expect(h.therapy.current().hold_extra_s).toBe(2);
  });

  it('blocks intensity at pain two and automatically reverts any new pain before the brake threshold', () => {
    const blocked = harness();
    blocked.therapy.recordFeeling({
      pain: 2,
      fatigue: 0,
      note: 'Pain.',
      source: 'ui',
    });
    expect(consent(blocked, 'faster').result).toBe('rejected');
    const h = harness({ assist_max_s: 6 });
    consent(h, 'faster');
    h.until(() => h.engine.state().phase === 'ASSIST');
    const before = h.commands().length;
    h.therapy.recordFeeling({
      pain: 1,
      fatigue: 0,
      note: 'Some pain appeared.',
      source: 'voice',
    });
    expect(h.engine.state().phase).toBe('ASSIST');
    expect(h.therapy.state()?.adjustments.intensified).toEqual([]);
    expect(h.therapy.current().assist_speed.index).toBe(0.2);
    expect(
      h
        .commands()
        .slice(before)
        .every((c) => c.t !== 'target' || c.v <= 0.2),
    ).toBe(true);
    expect(h.therapy.decisions()).toContainEqual(
      expect.objectContaining({
        tool: 'intensify',
        result: 'undone',
        source: 'local_rule',
        applied: expect.objectContaining({ auto_reverted: true }),
      }),
    );
    h.therapy.undo();
    h.until(
      () =>
        h.engine.state().index === 1 && h.engine.state().phase === 'ATTEMPT',
    );
    expect(h.therapy.current().assist_speed.index).toBe(0.2);
  });

  it('reverts a further target immediately on pain without creating a higher target', () => {
    const h = harness({ assist_max_s: 6 });
    consent(h, 'further');
    h.until(() => h.engine.state().phase === 'ASSIST');
    expect(h.commands().at(-1)).toMatchObject({ f: [0, 1, 0, 0, 0] });
    h.therapy.recordFeeling({
      pain: 2,
      fatigue: 0,
      note: 'Pain.',
      source: 'ui',
    });
    expect(h.engine.poseDef().closure.index).toBe(0.95);
    expect(h.commands().at(-1)).toMatchObject({
      f: [0, 0.95, 0, 0, 0],
      v: 0.2,
    });
  });

  it('blocks recent resistance across sessions and clears the block only after sixty seconds', () => {
    const h = harness({ present_s: 100 });
    h.therapy.resistance('index');
    expect(consent(h, 'faster').result).toBe('rejected');
    // A new session must not erase a recent safety event or a pain block.
    h.world.apply(h.engine.stop(h.world.now).commands);
    h.world.apply(
      h.engine.start(
        [{ pose: 'full_fist', reps: 1 }],
        { ...DEFAULT_EXERCISE_SETTINGS, present_s: 100 },
        calibration,
        h.world.now,
      ).commands,
    );
    expect(consent(h, 'faster').result).toBe('rejected');
    h.tick(60_001);
    expect(consent(h, 'faster').result).toBe('applied');
  });

  it('reverts intensity and lowers speed on a real resistance event; undo cannot resurrect it', () => {
    const h = harness({ assist_max_s: 6 });
    consent(h, 'faster');
    h.until(() => h.engine.state().phase === 'ASSIST');
    for (let i = 0; i < 7; i++) h.tick();
    h.world.ma = 600;
    h.until(() => h.engine.state().phase === 'ASSIST_HOLD');
    expect(h.therapy.state()?.last_safety).toMatchObject({
      source: 'resistance',
      finger: 'index',
    });
    expect(h.therapy.state()?.adjustments.intensified).toEqual([]);
    expect(h.therapy.current().assist_speed.index).toBe(0.15);
    h.therapy.undo();
    h.until(
      () =>
        h.engine.state().index === 1 && h.engine.state().phase === 'ATTEMPT',
    );
    expect(h.therapy.current().assist_speed.index).toBe(0.15);
  });
});

it('property: arbitrary tool sequences cannot bypass position, speed, calibrated range, current or brake limits', () => {
  // Seeded generated sequences exercise the real engine, scheduler and command stream.
  let seed = 0xace123;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (const initialCap of [0.05, 0.15, 0.2, 0.8]) {
    const h = harness({ assist_speed: initialCap, assist_max_s: 3 });
    const original = structuredClone(calibration);
    h.until(() => h.engine.state().phase === 'ASSIST');
    for (let i = 0; i < 800; i++) {
      const tools: CoachToolName[] = [
        'adjust_help',
        'set_attempt_time',
        'add_rest',
        'choose_next_pose',
        'record_feeling',
        'brake',
        'undo_last_adjustment',
        'get_live_state',
        'assist_finger_now',
        'adjust_target',
        'highlight_finger',
        'note_for_therapist',
        'repeat_pose',
        'intensify',
      ];
      const tool = tools[Math.floor(random() * tools.length)];
      const before = h.commands().length;
      h.call(tool, {
        finger: [...GLOVE_FINGERS, 'all', 'invalid'][Math.floor(random() * 7)],
        direction:
          tool === 'adjust_target'
            ? random() < 0.5
              ? 'lower'
              : 'raise'
            : ['more', 'less', 'gentler'][Math.floor(random() * 3)],
        text: 'Generated clinical note.',
        kind: ['further', 'hold_longer', 'faster'][Math.floor(random() * 3)],
        consent: 'accepted_offer',
        patient_quote: 'Yes, please.',
        seconds: (random() - 0.2) * 150,
        pose: ['full_fist', 'hook', 'pinch', 'invalid'][
          Math.floor(random() * 4)
        ],
        pain: Math.floor(random() * 12),
        fatigue: Math.floor(random() * 12),
        note: 'Generated feeling.',
        reason: 'Generated adjustment.',
        speed: 100,
        current_limit_ma: 99999,
        target: 99999,
      });
      if (tool === 'brake')
        expect(h.commands().slice(before)).toEqual([{ t: 'release' }]);
      const speeds = Object.values(h.therapy.state()!.adjustments.assist_speed);
      expect(Math.min(...speeds)).toBeGreaterThanOrEqual(
        Math.min(initialCap, 0.1),
      );
      expect(Math.max(...speeds)).toBeLessThanOrEqual(
        Math.min(initialCap, 0.2),
      );
      if (h.engine.state().phase === 'PAUSED' && random() < 0.2)
        h.world.apply(h.engine.resume(h.world.now).commands);
      h.tick(100);
    }
    expect(h.commands().some((c) => c.t === 'target')).toBe(true);
    for (const command of h.commands() as GloveCommand[]) {
      expect(command.t).not.toBe('limit');
      if (command.t === 'target') {
        expect(command.v).toBeGreaterThan(0);
        expect(command.v).toBeLessThanOrEqual(Math.min(initialCap, 0.2));
        for (const [i, value] of command.f.entries()) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(MAX_ASSIST_CLOSURE);
          const servo = calibration.servo[i];
          const angle = servo.min_deg + value * (servo.max_deg - servo.min_deg);
          expect(angle).toBeGreaterThanOrEqual(
            Math.min(servo.min_deg, servo.max_deg),
          );
          expect(angle).toBeLessThanOrEqual(
            Math.max(servo.min_deg, servo.max_deg),
          );
        }
      }
    }
    expect(calibration).toEqual(original);
  }
});

it('withdrawn consent and rejected malformed feelings cannot reopen the intensity gate', () => {
  const h = harness({ present_s: 100 });
  h.therapy.notePatientSpeech('Yes, please.');
  h.therapy.notePatientSpeech('No, please stop.');
  expect(
    h.call('intensify', {
      finger: 'index',
      kind: 'faster',
      consent: 'accepted_offer',
      patient_quote: 'Yes, please.',
    }).result,
  ).toBe('rejected');
  h.therapy.recordFeeling({ pain: 2, fatigue: 0, note: 'Pain.', source: 'ui' });
  expect(
    h.call('record_feeling', { pain: -1, fatigue: 0, note: 'Invalid.' }).result,
  ).toBe('rejected');
  expect(
    h.call('record_feeling', { pain: 0, fatigue: 'invalid', note: 'Invalid.' })
      .result,
  ).toBe('rejected');
  h.therapy.notePatientSpeech('Yes, please.');
  expect(
    h.call('intensify', {
      finger: 'index',
      kind: 'faster',
      consent: 'accepted_offer',
      patient_quote: 'Yes, please.',
    }).result,
  ).toBe('rejected');
});

it('expired consent cannot be restored by Undo and safety observers cannot interrupt a brake', () => {
  const h = harness({ present_s: 30 });
  h.therapy.notePatientSpeech('Yes, please.');
  for (const finger of ['index', 'middle'])
    h.call('intensify', {
      finger,
      kind: 'faster',
      consent: 'accepted_offer',
      patient_quote: 'Yes, please.',
    });
  h.tick(1000);
  h.tick(30_000);
  h.therapy.undo();
  expect(h.therapy.state()?.adjustments.intensified).toEqual([]);
  h.therapy.onDecision(() => {
    throw new Error('Broken observer');
  });
  h.therapy.brake('Stop.', 'local_rule');
  expect(h.engine.state().phase).toBe('PAUSED');
  expect(h.world.tel.md).toBe('none');
});

it('property: consented intensity remains inside calibration, 0.30/s, hold, shaping and current limits', () => {
  let seed = 123456;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (const cap of [0.15, 0.3]) {
    const settings = {
      ...DEFAULT_EXERCISE_SETTINGS,
      present_s: 0,
      attempt_s: 1,
      hold_s: 0.1,
      assist_max_s: 3,
      rest_s: 0.1,
      plateau_s: 99,
      assist_speed: cap,
    };
    const plan: ExercisePlanItem[] = [{ pose: 'full_fist', reps: 8 }];
    const h = harness(settings, plan);
    const original = structuredClone(calibration);
    for (let step = 0; step < 500; step++) {
      if (h.engine.state().phase === 'DONE')
        h.world.apply(
          h.engine.start(plan, settings, calibration, h.world.now).commands,
        );
      if (h.engine.state().phase === 'PAUSED') h.call('resume_session');
      const finger = GLOVE_FINGERS[Math.floor(random() * GLOVE_FINGERS.length)];
      const tool = [
        'intensify',
        'adjust_target',
        'adjust_help',
        'assist_finger_now',
        'repeat_pose',
      ][Math.floor(random() * 5)] as CoachToolName;
      if (tool === 'intensify') h.therapy.notePatientSpeech('Yes, please.');
      h.call(tool, {
        finger,
        kind: ['further', 'hold_longer', 'faster'][Math.floor(random() * 3)],
        consent: 'accepted_offer',
        patient_quote: 'Yes, please.',
        direction:
          tool === 'adjust_target'
            ? random() < 0.5
              ? 'lower'
              : 'raise'
            : ['more', 'less', 'gentler'][Math.floor(random() * 3)],
        reason: 'Generated request.',
        speed: 999,
        target: 999,
        hold: 999,
        current_limit_ma: 99999,
      });
      h.world.ma = step % 100 >= 40 && step % 100 < 49 ? 600 : 100;
      if (step % 100 === 70)
        h.therapy.recordFeeling({
          pain: 2,
          fatigue: 1,
          note: 'Some pain.',
          source: 'ui',
        });
      if (step % 100 === 80)
        h.therapy.recordFeeling({
          pain: 0,
          fatigue: 1,
          note: 'Comfortable again.',
          source: 'ui',
        });
      h.tick(100);
      const adjustments = h.therapy.state()!.adjustments;
      expect(
        Math.max(...Object.values(adjustments.assist_speed)),
      ).toBeLessThanOrEqual(0.3);
      expect(
        Math.min(...Object.values(adjustments.target_scale)),
      ).toBeGreaterThanOrEqual(0.5);
      expect(
        Math.max(...Object.values(adjustments.target_scale)),
      ).toBeLessThanOrEqual(1);
      expect(adjustments.hold_extra_s).toBeLessThanOrEqual(2);
      expect(adjustments.extra_reps).toBeLessThanOrEqual(3);
    }
    for (const command of h.commands()) {
      expect(command.t).not.toBe('limit');
      if (command.t === 'target') {
        expect(command.v).toBeLessThanOrEqual(0.3);
        expect(command.v).toBeGreaterThan(0);
        for (const [i, position] of command.f.entries()) {
          expect(position).toBeGreaterThanOrEqual(0);
          expect(position).toBeLessThanOrEqual(1);
          const servo = calibration.servo[i];
          const angle =
            servo.min_deg + position * (servo.max_deg - servo.min_deg);
          expect(angle).toBeGreaterThanOrEqual(
            Math.min(servo.min_deg, servo.max_deg),
          );
          expect(angle).toBeLessThanOrEqual(
            Math.max(servo.min_deg, servo.max_deg),
          );
        }
      }
    }
    expect(calibration).toEqual(original);
  }
});

it('caps early assistance duration even after that finger reaches and other delays are still pending', () => {
  const h = harness({ attempt_s: 9, assist_max_s: 2 });
  h.until(() => h.engine.state().phase === 'ATTEMPT');
  h.call('assist_finger_now', { finger: 'index', reason: 'Help now.' });
  h.world.hand = [0, 0.95, 0, 0, 0];
  h.tick(2000);
  expect(h.engine.state().phase).toBe('ASSIST_HOLD');
});

it('uses an injected consent clock independently of accelerated motor time', () => {
  let wall = 10_000;
  const world = new FakeWorld();
  const engine = createExerciseEngine({
    therapy: { sessionId: () => 1, now: () => wall },
  });
  world.apply(
    engine.start(
      [{ pose: 'full_fist', reps: 1 }],
      { ...DEFAULT_EXERCISE_SETTINGS, present_s: 0 },
      calibration,
      0,
    ).commands,
  );
  engine.therapy.notePatientSpeech('Yes, please.', wall);
  const d = engine.therapy.adjust(
    'intensify',
    {
      finger: 'index',
      kind: 'faster',
      consent: 'accepted_offer',
      patient_quote: 'Yes, please.',
    },
    'coach',
  );
  expect(d.result).toBe('applied');
  wall += 1000;
  world.apply(engine.tick(world.step(30_000)).commands);
  world.apply(engine.tick(world.step(500)).commands);
  expect(engine.state().phase).toBe('ATTEMPT');
  expect(engine.therapy.current().assist_speed.index).toBe(0.3);
});

it('an unattributed firmware fault revokes intensity and a mutable UI pose cannot change motor goals', () => {
  const h = harness({ assist_max_s: 6 });
  h.therapy.notePatientSpeech('Yes, please.');
  h.call('intensify', {
    finger: 'index',
    kind: 'faster',
    consent: 'accepted_offer',
    patient_quote: 'Yes, please.',
  });
  h.until(() => h.engine.state().phase === 'ATTEMPT');
  h.engine.poseDef().closure.index = 999;
  h.until(() => h.engine.state().phase === 'ASSIST');
  expect(h.commands().at(-1)).toMatchObject({ f: [0, 0.95, 0, 0, 0], v: 0.3 });
  h.world.tel.st = 'fault';
  h.tick();
  expect(h.engine.state().phase).toBe('PAUSED');
  expect(h.commands().at(-1)).toEqual({ t: 'release' });
  expect(h.therapy.state()?.adjustments.intensified).toEqual([]);
  expect(h.therapy.state()?.last_safety).toMatchObject({
    source: 'firmware_fault',
  });
});
