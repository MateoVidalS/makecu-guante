import { describe, expect, it } from 'vitest';
import type {
  AttemptResult,
  EngineEvent,
  ExerciseSettings,
} from '../contracts/engine';
import { DEFAULT_EXERCISE_SETTINGS, DEFAULT_PLAN } from '../contracts/poses';
import type { PoseId } from '../contracts/poses';
import { createExerciseEngine } from './exercise';
import type { EngineInput, ExerciseEngine, Output } from './types';
import { calibration, curve, FakeWorld } from './test/fakeWorld';

const settings = (
  overrides: Partial<ExerciseSettings> = {},
): ExerciseSettings => ({
  ...DEFAULT_EXERCISE_SETTINGS,
  present_s: 0,
  rest_s: 0.1,
  hold_s: 0.2,
  ...overrides,
});
class Run {
  world = new FakeWorld();
  engine: ExerciseEngine;
  outputs: Output[] = [];
  events: EngineEvent[] = [];
  constructor(
    pose: PoseId = 'hook',
    overrides: Partial<ExerciseSettings> = {},
  ) {
    this.engine = createExerciseEngine();
    this.accept(
      this.engine.start(
        [{ pose, reps: 1 }],
        settings(overrides),
        calibration,
        0,
      ),
    );
  }
  accept(out: Output): Output {
    this.world.apply(out.commands);
    this.outputs.push(out);
    this.events.push(...out.events);
    return out;
  }
  step(ms = 50, change?: (input: EngineInput) => void): Output {
    const input = this.world.step(ms);
    change?.(input);
    return this.accept(this.engine.tick(input));
  }
  until(
    phase: ReturnType<ExerciseEngine['state']>['phase'],
    limit = 1000,
  ): void {
    for (let i = 0; i < limit && this.engine.state().phase !== phase; i++)
      this.step();
    expect(this.engine.state().phase).toBe(phase);
  }
  results(): AttemptResult[] {
    return this.events.flatMap((e) =>
      e.kind === 'attempt_done' ? [e.result] : [],
    );
  }
}

describe('exercise phase table (06-session §3 and §6)', () => {
  it('requires 500 ms continuous visibility, waits indefinitely, and re-prompts every 8 s', () => {
    const r = new Run();
    r.world.confidence = 0.59;
    for (let i = 0; i < 180; i++) r.step();
    expect(r.engine.state().phase).toBe('PRESENT');
    expect(
      r.events.filter((e) => e.kind === 'phase' && e.phase === 'PRESENT'),
    ).toHaveLength(2);
    expect(
      r.outputs
        .flatMap((o) => o.commands)
        .some((c) => c.t === 'follow' || c.t === 'target'),
    ).toBe(false);
    r.world.confidence = 0.6;
    r.step(400);
    r.step(450);
    expect(r.engine.state().phase).toBe('PRESENT');
    r.step(50);
    expect(r.engine.state().phase).toBe('ATTEMPT');
  });
  it('actively reaches, dwells, holds and records without assistance', () => {
    const r = new Run();
    r.until('ATTEMPT');
    const start = r.world.now;
    for (let i = 0; i < 30 && r.engine.state().phase !== 'DONE'; i++) {
      r.world.hand = [
        0,
        curve(
          [
            [0, 0],
            [500, 0.6],
          ],
          r.world.now - start,
        ),
        0.6,
      ];
      r.step();
    }
    r.until('DONE');
    const result = r.results()[0];
    expect(result).toMatchObject({
      reached_active: true,
      reached_final: true,
      assisted: false,
      interrupted: false,
      current_mean_ma: null,
    });
    expect(result.time_to_position_s).toBeCloseTo(0.5);
    expect(result.fingers[1]).toMatchObject({
      active_max: 0.6,
      assist_needed: 0,
      final: 0.6,
    });
    expect(result.fingers[0].scored).toBe(false);
    expect(
      r.outputs.flatMap((o) => o.commands).some((c) => c.t === 'target'),
    ).toBe(false);
    expect(
      r.events.filter((e) => e.kind === 'phase').map((e) => e.phase),
    ).toEqual(['PRESENT', 'ATTEMPT', 'HOLD', 'RELEASE', 'REST', 'DONE']);
    expect(result.trace.t[0]).toBe(0);
    expect(result.trace.phase.at(-1)).toBe('RELEASE');
  });
  it('times out on partial closure, holds reached/free fingers, and reaches with assistance', () => {
    const r = new Run('hook', { attempt_s: 1 });
    r.world.hand = [0.2, 0.3, 0.6];
    r.until('ASSIST');
    const target = r.outputs.at(-1)!.commands.find((c) => c.t === 'target');
    expect(target).toMatchObject({ t: 'target', f: [0.17, 0.6, 0.6], v: 0.3 });
    const count = r.outputs
      .flatMap((o) => o.commands)
      .filter((c) => c.t === 'target').length;
    r.step();
    expect(
      r.outputs.flatMap((o) => o.commands).filter((c) => c.t === 'target'),
    ).toHaveLength(count);
    r.world.hand = [0.2, 0.6, 0.6];
    r.until('DONE');
    expect(r.results()[0]).toMatchObject({
      reached_active: false,
      reached_final: true,
      assisted: true,
      time_to_position_s: null,
      current_mean_ma: 100,
    });
    expect(r.results()[0].fingers[1].assist_needed).toBeCloseTo(0.3);
    expect(r.events).toContainEqual(
      expect.objectContaining({ kind: 'reached', assisted: true }),
    );
  });
  it('plateaus after at least 3 seconds and observation mode releases without assist', () => {
    const r = new Run('hook', { attempt_s: 20 });
    r.world.hand = [0, 0.2, 0.2];
    r.until('ATTEMPT');
    const start = r.world.now;
    r.until('ASSIST');
    expect(r.world.now - start).toBe(3000);
    const observation = new Run('hook', {
      attempt_s: 0.1,
      assist_enabled: false,
    });
    observation.until('DONE');
    expect(observation.results()[0].assisted).toBe(false);
    expect(
      observation.outputs
        .flatMap((o) => o.commands)
        .some((c) => c.t === 'target'),
    ).toBe(false);
  });
  it('scores best opening and ignores ring/pinky', () => {
    const r = new Run('open');
    r.world.hand = [0.8, 0.8, 0.8];
    r.until('ATTEMPT');
    r.world.hand = [0.05, 0.05, 0.05];
    r.until('HOLD');
    r.world.hand = [0.4, 0.4, 0.4];
    r.until('DONE');
    expect(r.results()[0].active_ratio).toBeCloseTo(0.95);
    expect(r.results()[0].fingers[1]).toMatchObject({
      active_max: 0.05,
      final: 0.4,
      assist_needed: 0.05,
    });
  });
  it('requires calibrated pinch distance as well as scored closure', () => {
    const r = new Run('pinch');
    r.world.hand = [0.5, 0.55, 0];
    r.world.pinch = 0.15;
    r.until('ATTEMPT');
    for (let i = 0; i < 15; i++) r.step();
    expect(r.engine.state().phase).toBe('ATTEMPT');
    r.world.pinch = 0.12;
    r.until('DONE');
    expect(r.results()[0]).toMatchObject({
      reached_active: true,
      pinch_min: 0.12,
    });
    expect(r.results()[0].fingers[2].scored).toBe(false);
  });
  it('settles for one second or caps assistance without claiming visual reach', () => {
    const r = new Run('hook', { attempt_s: 0.1, assist_max_s: 10 });
    r.until('ASSIST');
    const start = r.world.now;
    r.until('ASSIST_HOLD');
    expect(r.world.now - start).toBeGreaterThanOrEqual(2950);
    r.until('DONE');
    expect(r.results()[0].reached_final).toBe(false);
    const cap = new Run('hook', { attempt_s: 0.1, assist_max_s: 0.2 });
    cap.until('ASSIST');
    const capStart = cap.world.now;
    cap.until('ASSIST_HOLD');
    expect(cap.world.now - capStart).toBe(200);
  });
  it('throttles follow by frame identity and progress to 2 Hz per finger', () => {
    const r = new Run();
    r.until('ATTEMPT');
    const input = r.world.step();
    r.accept(r.engine.tick(input));
    const same = r.engine.tick(input);
    expect(same.commands.some((c) => c.t === 'follow')).toBe(false);
    const times: Record<string, number> = {};
    for (let i = 0; i < 30; i++) {
      r.world.hand = [0, i * 0.01, i * 0.01];
      const out = r.step();
      for (const e of out.events)
        if (e.kind === 'progress') {
          if (times[e.finger] !== undefined)
            expect(r.world.now - times[e.finger]).toBeGreaterThanOrEqual(500);
          times[e.finger] = r.world.now;
        }
    }
    expect(Object.keys(times)).toEqual(['index', 'middle']);
  });
});

describe('exercise safety (06-session §3)', () => {
  it('suppresses follow during low confidence ATTEMPT while its timer keeps running', () => {
    const r = new Run('hook', { attempt_s: 1 });
    r.until('ATTEMPT');
    r.world.confidence = 0.59;
    for (let i = 0; i < 20; i++)
      expect(
        r.step().commands.every((c) => c.t !== 'target' && c.t !== 'follow'),
      ).toBe(true);
    expect(r.engine.state().phase).toBe('ASSIST');
  });
  it('releases at 300 ms of low confidence in ASSIST and pauses at 1 s', () => {
    const r = new Run('hook', { attempt_s: 0.1 });
    r.until('ASSIST');
    r.world.confidence = 0;
    r.step();
    const start = r.world.now;
    for (let i = 0; i < 5; i++) expect(r.step().commands).toEqual([]);
    expect(r.step().commands).toEqual([{ t: 'release' }]);
    r.until('PAUSED');
    expect(r.world.now - start).toBe(1000);
    expect(r.events).toContainEqual({
      kind: 'safety',
      source: 'camera_lost',
      finger: null,
      ma: null,
    });
  });
  it('attributes overcurrent from the largest gap in the last 300 ms', () => {
    const r = new Run('hook', { attempt_s: 0.1 });
    r.until('ASSIST');
    r.step(100, (input) => {
      input.tel!.a = [0.1, 0.6, 0.3];
    });
    r.world.schedule(r.world.now + 50, 'overcurrent', 950);
    const out = r.step();
    expect(out.commands).toEqual([{ t: 'release' }]);
    expect(out.events).toContainEqual({
      kind: 'safety',
      source: 'overcurrent',
      finger: 'index',
      ma: 950,
    });
    expect(r.engine.state().phase).toBe('PAUSED');
    r.accept(r.engine.resume(r.world.now));
    r.until('DONE');
    expect(r.results()[0]).toMatchObject({
      interrupted: true,
      safety_events: [{ source: 'overcurrent', finger: 'index', ma: 950 }],
    });
  });
  it('reports null attribution when no recent vision has a positive gap', () => {
    const r = new Run();
    r.world.hand = [0.8, 0.8, 0.8];
    r.until('HOLD');
    r.world.schedule(r.world.now + 50, 'overcurrent', 950);
    r.step();
    expect(r.events).toContainEqual(
      expect.objectContaining({ kind: 'safety', finger: null }),
    );
  });
  it('pre-empts sustained resistance once and holds the achieved servo positions', () => {
    const r = new Run('hook', { attempt_s: 0.1, hold_s: 0.5 });
    r.until('ASSIST');
    for (let i = 0; i < 7; i++) r.step();
    r.world.ma = 400;
    for (let i = 0; i < 5; i++) r.step();
    expect(r.engine.state().phase).toBe('ASSIST');
    const out = r.step();
    expect(r.engine.state().phase).toBe('ASSIST_HOLD');
    expect(out.events).toContainEqual({
      kind: 'resistance',
      finger: 'index',
      ma: 400,
    });
    expect(out.commands).toContainEqual({
      t: 'target',
      f: [...r.world.tel.a],
      v: 0.3,
    });
    r.until('DONE');
    expect(r.events.filter((e) => e.kind === 'resistance')).toHaveLength(1);
    expect(r.results()[0]).toMatchObject({
      current_peak_ma: 400,
      safety_events: [{ source: 'resistance' }],
    });
  });
  it.each(['stop_button', 'watchdog'] as const)(
    '%s pauses; resume releases first and does not send motion while fault persists',
    (event) => {
      const r = new Run();
      r.until('ATTEMPT');
      r.world.schedule(r.world.now + 50, event);
      expect(r.step().commands).toEqual([{ t: 'release' }]);
      expect(
        r.engine.tick({
          ...r.world.step(),
          tel: { ...r.world.tel, st: 'fault' },
        }).commands,
      ).toEqual([]);
      expect(r.accept(r.engine.resume(r.world.now)).commands[0]).toEqual({
        t: 'release',
      });
      const out = r.engine.tick({
        ...r.world.step(),
        tel: { ...r.world.tel, st: 'fault' },
      });
      expect(out.commands).toEqual([{ t: 'release' }]);
      expect(r.engine.state().phase).toBe('PAUSED');
    },
  );
  it('pauses on disconnect and on fault telemetry even without an event', () => {
    const r = new Run();
    r.until('ATTEMPT');
    r.world.connected = false;
    r.step();
    expect(r.events).toContainEqual(
      expect.objectContaining({ kind: 'safety', source: 'glove_disconnected' }),
    );
    const fault = new Run();
    fault.until('ATTEMPT');
    fault.world.tel.st = 'fault';
    expect(fault.step().commands).toEqual([{ t: 'release' }]);
    expect(fault.engine.state().phase).toBe('PAUSED');
  });
  it('records interrupted attempts for pause/resume, skip, and stop mid-attempt', () => {
    for (const action of ['pause', 'skip', 'stop'] as const) {
      const r = new Run();
      r.until('ATTEMPT');
      expect(r.accept(r.engine[action](r.world.now)).commands[0]).toEqual({
        t: 'release',
      });
      if (action === 'pause') {
        expect(r.step().commands).toEqual([]);
        r.accept(r.engine.resume(r.world.now));
      }
      r.until('DONE');
      expect(r.results()).toHaveLength(1);
      expect(r.results()[0].interrupted).toBe(true);
      expect(r.engine.stop(r.world.now).events).toEqual([]);
    }
  });
  it('treats stale frames as unseen and resets a broken reach dwell', () => {
    const r = new Run();
    r.until('ATTEMPT');
    r.world.hand = [0, 0.6, 0.6];
    for (let i = 0; i < 8; i++) r.step();
    r.step(50, (input) => {
      input.vision!.t -= 301;
    });
    for (let i = 0; i < 8; i++) r.step();
    expect(r.engine.state().phase).toBe('ATTEMPT');
    r.until('HOLD');
  });
});

it('completes the full default plan, 15 attempts, in under 200 ms CPU', () => {
  const r = new Run();
  r.outputs = [];
  r.events = [];
  r.world = new FakeWorld();
  r.accept(
    r.engine.start(DEFAULT_PLAN, DEFAULT_EXERCISE_SETTINGS, calibration, 0),
  );
  const start = process.cpuUsage();
  for (let i = 0; i < 20000 && r.engine.state().phase !== 'DONE'; i++) {
    const pose = r.engine.state().pose;
    r.world.hand = pose === 'open' ? [0, 0, 0] : [0.7, 1, 1];
    r.step();
  }
  const elapsed = process.cpuUsage(start);
  expect(r.engine.state().phase).toBe('DONE');
  expect(r.results()).toHaveLength(15);
  expect(elapsed.user + elapsed.system).toBeLessThan(200000);
  expect(r.events.at(-1)).toMatchObject({
    kind: 'session_done',
    summary: { attempts: 15, reached_active: 15, previous: null },
  });
});

it('preserves the motion safety property over seeded random inputs and lifecycle actions', () => {
  let seed = 0x4ab123;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const r = new Run('full_fist', { attempt_s: 0.3 });
  const phases = new Set<string>();
  for (let i = 0; i < 20000; i++) {
    if (r.engine.state().phase === 'DONE')
      r.accept(
        r.engine.start(
          [{ pose: 'full_fist', reps: 2 }],
          settings({ attempt_s: 0.3 }),
          calibration,
          r.world.now,
        ),
      );
    const roll = random();
    if (roll < 0.01) r.accept(r.engine.pause(r.world.now));
    else if (roll < 0.1) r.accept(r.engine.resume(r.world.now));
    else if (roll < 0.11) r.accept(r.engine.skip(r.world.now));
    else if (roll < 0.115) r.accept(r.engine.stop(r.world.now));
    const input = r.world.step(20 + Math.floor(random() * 80));
    input.vision!.confidence =
      random() < 0.2 ? random() * 0.6 : 0.6 + random() * 0.4;
    input.gloveConnected = random() > 0.005;
    if (random() < 0.01) input.tel!.st = 'fault';
    input.vision!.closure!.index = random();
    input.vision!.closure!.middle = random();
    const out = r.engine.tick(input);
    phases.add(r.engine.state().phase);
    if (
      input.vision!.confidence < 0.6 ||
      input.tel!.st === 'fault' ||
      r.engine.state().phase === 'PAUSED' ||
      !input.gloveConnected
    ) {
      expect(
        out.commands.every((c) => c.t !== 'target' && c.t !== 'follow'),
      ).toBe(true);
    }
    r.world.apply(out.commands);
  }
  expect(phases.has('ASSIST')).toBe(true);
  expect(phases.has('PAUSED')).toBe(true);
});
