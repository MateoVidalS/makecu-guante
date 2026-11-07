import { describe, expect, it, vi } from 'vitest';
import type { CoachToolName } from '../contracts/therapist';
import type { ExerciseSettings } from '../contracts/engine';
import { GLOVE_FINGERS } from '../contracts/glove';
import {
  DEFAULT_EXERCISE_SETTINGS,
  MAX_ASSIST_CLOSURE,
} from '../contracts/poses';
import { createExerciseEngine } from './exercise';
import type { GloveCommand, Output } from './types';
import { calibration, FakeWorld } from './test/fakeWorld';

function harness(settings: Partial<ExerciseSettings> = {}) {
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
      [
        { pose: 'full_fist', reps: 3 },
        { pose: 'hook', reps: 1 },
      ],
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

  it('lowers help immediately without starting another finger, and stages undo until the next ASSIST', () => {
    const h = harness({ assist_max_s: 2 });
    h.until(() => h.engine.state().phase === 'ASSIST');
    const target = h
      .commands()
      .filter((c) => c.t === 'target')
      .at(-1)!;
    const count = h.commands().length;
    const lower = h.call('adjust_help', {
      finger: 'all',
      direction: 'less',
      reason: 'Gentler help.',
    });
    expect(lower.result).toBe('applied');
    expect(h.commands().slice(count)).toEqual([{ ...target, v: 0.25 }]);
    expect(
      h.call('adjust_help', {
        finger: 'index',
        direction: 'less',
        reason: 'Less.',
      }).result,
    ).toBe('rejected');
    const beforeUndo = h.commands().length;
    expect(h.therapy.undo()?.result).toBe('undone');
    expect(h.commands()).toHaveLength(beforeUndo);
    expect(h.therapy.current().assist_speed.index).toBe(0.25);
    h.until(
      () => h.engine.state().index === 1 && h.engine.state().phase === 'ASSIST',
    );
    expect(h.therapy.current().assist_speed.index).toBe(0.3);
    expect(
      h.call('adjust_help', {
        finger: 'index',
        direction: 'less',
        reason: 'Less.',
      }).result,
    ).toBe('applied');
  });

  it('queues more help until ASSIST and atomically rejects overlapping all-finger adjustments', () => {
    const h = harness();
    h.call('adjust_help', {
      finger: 'index',
      direction: 'less',
      reason: 'Gentle index.',
    });
    expect(
      h.call('adjust_help', {
        finger: 'all',
        direction: 'less',
        reason: 'Gentle all.',
      }).result,
    ).toBe('rejected');
    expect(h.therapy.state()?.adjustments.assist_speed.middle).toBe(0.3);
    h.until(
      () =>
        h.engine.state().index === 1 && h.engine.state().phase === 'ATTEMPT',
    );
    h.call('adjust_help', {
      finger: 'index',
      direction: 'more',
      reason: 'Help the tired finger.',
    });
    expect(h.therapy.current().assist_speed.index).toBe(0.25);
    h.until(() => h.engine.state().phase === 'ASSIST');
    expect(h.therapy.current().assist_speed.index).toBe(0.3);
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
    expect(h.therapy.limits.assist_speed[1]).toBe(0.3);
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
    expect(h.therapy.state()?.adjustments.assist_speed.index).toBe(0.3);
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

it('property: arbitrary tool sequences cannot bypass position, speed, calibrated range, current or brake limits', () => {
  // Seeded generated sequences exercise the real engine, scheduler and command stream.
  let seed = 0xace123;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (const initialCap of [0.05, 0.15, 0.3, 0.8]) {
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
      ];
      const tool = tools[Math.floor(random() * tools.length)];
      const before = h.commands().length;
      h.call(tool, {
        finger: [...GLOVE_FINGERS, 'all', 'invalid'][Math.floor(random() * 7)],
        direction: random() < 0.5 ? 'more' : 'less',
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
        Math.min(initialCap, 0.3),
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
        expect(command.v).toBeLessThanOrEqual(Math.min(initialCap, 0.3));
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
