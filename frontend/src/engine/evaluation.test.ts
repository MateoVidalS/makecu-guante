import { describe, expect, it } from 'vitest';
import type { EvalSettings } from '../contracts/evaluation';
import { DEFAULT_EVAL_SETTINGS } from '../contracts/poses';
import type { EngineInput, EvaluationEngine, Output } from './types';
import {
  createEvaluationEngine,
  frictionRun,
  interpolateFriction,
} from './evaluation';
import { calibration, FakeWorld } from './test/fakeWorld';

class EvalRun {
  world = new FakeWorld();
  outputs: Output[] = [];
  constructor(
    readonly engine: EvaluationEngine = createEvaluationEngine(),
    readonly config: EvalSettings = DEFAULT_EVAL_SETTINGS,
    friction = true,
  ) {
    this.accept(
      engine.start(
        config,
        { ...calibration, friction: friction ? calibration.friction : {} },
        0,
      ),
    );
  }
  accept(out: Output): Output {
    this.outputs.push(out);
    this.world.apply(out.commands);
    return out;
  }
  step(ms = 50, change?: (input: EngineInput) => void): Output {
    const input = this.world.step(ms);
    change?.(input);
    return this.accept(this.engine.tick(input));
  }
  until(
    stage: ReturnType<EvaluationEngine['state']>['stage'],
    limit = 5000,
  ): void {
    for (let i = 0; i < limit && this.engine.state().stage !== stage; i++) {
      // Empty glove friction: 80 + 40 * position. Patient resistance adds speed-dependent current.
      const state = this.engine.state();
      const iFinger = ['thumb', 'index', 'middle', 'ring', 'pinky'].indexOf(
        state.finger ?? 'thumb',
      );
      this.world.ma =
        80 +
        40 * this.world.tel.a[iFinger] +
        (state.speed === 'slow' ? 50 : 150);
      this.step();
    }
    expect(this.engine.state().stage).toBe(stage);
  }
}
const one: EvalSettings = { ...DEFAULT_EVAL_SETTINGS, fingers: ['index'] };

describe('evaluation (06-session §5 and §6)', () => {
  it('lowers the limit, releases, and requires one continuous second at zero before targeting', () => {
    const r = new EvalRun();
    expect(r.outputs[0].commands).toEqual([
      { t: 'limit', ma: 600 },
      { t: 'release' },
    ]);
    for (let i = 0; i < 20; i++) expect(r.step().commands).toEqual([]);
    const out = r.step();
    expect(out.commands).toEqual([{ t: 'target', f: [1, 0, 0, 0, 0], v: 0.2 }]);
    expect(r.engine.state()).toMatchObject({
      stage: 'sweep',
      finger: 'thumb',
      speed: 'slow',
      progress: 0,
    });
  });
  it('sweeps slow then fast per finger, cools down, subtracts friction and restores exercise limit', () => {
    const r = new EvalRun();
    r.until('done');
    const result = r.engine.state().result!;
    const targets = r.outputs
      .flatMap((o) => o.commands)
      .filter((c) => c.t === 'target');
    expect(targets).toEqual([
      { t: 'target', f: [1, 0, 0, 0, 0], v: 0.2 },
      { t: 'target', f: [1, 0, 0, 0, 0], v: 1 },
      { t: 'target', f: [0, 1, 0, 0, 0], v: 0.2 },
      { t: 'target', f: [0, 1, 0, 0, 0], v: 1 },
      { t: 'target', f: [0, 0, 1, 0, 0], v: 0.2 },
      { t: 'target', f: [0, 0, 1, 0, 0], v: 1 },
    ]);
    expect(result.sweeps).toHaveLength(6);
    expect(result.friction_used).toBe(true);
    // The fake current uses the preceding telemetry sample, so the slow/fast lag is known.
    for (const finger of result.fingers) {
      expect(finger.resistance_slow_ma).toBeCloseTo(49.6);
      expect(finger.resistance_fast_ma).toBeCloseTo(148);
      expect(finger.velocity_dependence_ma).toBeCloseTo(98.4);
      expect(finger.aborted).toBe(false);
    }
    expect(r.outputs.at(-1)!.commands).toEqual([
      { t: 'release' },
      { t: 'limit', ma: 900 },
    ]);
    expect(r.engine.tick(r.world.step()).commands).toEqual([]);
    expect(r.engine.stop(r.world.now).commands).toEqual([]);
  });
  it('records telemetry once per timestamp and interpolates unsorted friction without mutating it', () => {
    const r = new EvalRun(undefined, one);
    r.until('sweep');
    const input = r.world.step();
    r.accept(r.engine.tick(input));
    r.accept(r.engine.tick(input));
    r.until('done');
    expect(
      r.engine.state().result!.sweeps[0].points.filter((p) => p.pos === 0.01),
    ).toHaveLength(1);
    const friction = {
      v: 0.2,
      points: [
        { pos: 1, ma: 120 },
        { pos: 0, ma: 80 },
        { pos: 0.5, ma: 100 },
      ],
    };
    expect(interpolateFriction(friction, 0.25)).toBe(90);
    expect(interpolateFriction(friction, -1)).toBe(80);
    expect(interpolateFriction(friction, 2)).toBe(120);
    expect(friction.points[0].pos).toBe(1);
    expect(interpolateFriction(undefined, 0.3)).toBe(0);
  });
  it('aborts slow on overcurrent, clears fault with release, skips fast for that finger, and continues', () => {
    const config = {
      ...DEFAULT_EVAL_SETTINGS,
      fingers: ['index', 'middle'] as const,
    };
    const r = new EvalRun(undefined, {
      ...config,
      fingers: [...config.fingers],
    });
    r.until('sweep');
    for (let i = 0; i < 30; i++) r.step();
    r.world.schedule(r.world.now + 50, 'overcurrent', 650);
    const out = r.step();
    expect(out.commands).toEqual([{ t: 'release' }]);
    expect(out.events).toEqual([
      { kind: 'safety', source: 'overcurrent', finger: 'index', ma: 650 },
    ]);
    expect(r.world.tel.st).toBe('idle');
    expect(r.engine.state().stage).toBe('cooldown');
    r.until('done');
    const result = r.engine.state().result!;
    expect(result.sweeps.map((s) => [s.finger, s.speed])).toEqual([
      ['index', 'slow'],
      ['middle', 'slow'],
      ['middle', 'fast'],
    ]);
    expect(result.sweeps[0].aborted_at).toBeCloseTo(0.31);
    expect(result.fingers[0]).toMatchObject({
      aborted: true,
      resistance_fast_ma: null,
      velocity_dependence_ma: null,
    });
    expect(
      r.outputs.flatMap((o) => o.commands).filter((c) => c.t === 'target'),
    ).toHaveLength(3);
  });
  it('retains successful slow data if fast aborts', () => {
    const r = new EvalRun(undefined, one);
    r.until('sweep');
    r.until('cooldown');
    r.until('prepare');
    r.until('sweep');
    r.world.schedule(r.world.now + 50, 'overcurrent', 650);
    r.step();
    r.until('done');
    const result = r.engine.state().result!;
    expect(result.sweeps[0].aborted_at).toBeNull();
    expect(result.sweeps[1].aborted_at).not.toBeNull();
    expect(result.fingers[0]).toMatchObject({
      aborted: true,
      resistance_fast_ma: null,
    });
  });
  it('uses zero friction when absent, including a missing curve at the requested speed', () => {
    const r = new EvalRun(undefined, one, false);
    r.until('done');
    const result = r.engine.state().result!;
    expect(result.friction_used).toBe(false);
    expect(
      result.sweeps.every((s) => s.points.every((p) => p.excess_ma === p.ma)),
    ).toBe(true);
    const engine = createEvaluationEngine();
    const c = {
      ...calibration,
      friction: {
        index: [
          {
            v: 0.2,
            points: [
              { pos: 0, ma: 100 },
              { pos: 1, ma: 100 },
            ],
          },
        ],
      },
    };
    const partial = new EvalRun(engine, one);
    partial.outputs = [];
    partial.world = new FakeWorld();
    partial.accept(engine.start(one, c, 0));
    partial.until('done');
    expect(engine.state().result!.friction_used).toBe(false);
    expect(
      engine
        .state()
        .result!.sweeps[1].points.every((p) => p.excess_ma === p.ma),
    ).toBe(true);
  });
  it('waits through latched fault, low confidence and off-zero telemetry before any target', () => {
    const r = new EvalRun(undefined, one);
    for (let i = 0; i < 30; i++) {
      const out = r.step(50, (input) => {
        input.tel!.st = 'fault';
      });
      expect(out.commands).toEqual([{ t: 'release' }]);
    }
    for (let i = 0; i < 30; i++) {
      const out = r.step(50, (input) => {
        input.tel!.a = [0.3, 0, 0, 0, 0];
      });
      expect(out.commands).toEqual([]);
    }
    r.world.confidence = 0.5;
    for (let i = 0; i < 30; i++) expect(r.step().commands).toEqual([]);
    r.world.confidence = 0.6;
    expect(r.step().commands).toEqual([
      { t: 'target', f: [0, 1, 0, 0, 0], v: 0.2 },
    ]);
  });
  it.each([
    'stop_button',
    'watchdog',
    'glove_disconnected',
    'camera_lost',
    'fault',
    'stop',
  ] as const)('safely ends %s and restores the limit', (failure) => {
    const r = new EvalRun(undefined, one);
    r.until('sweep');
    r.step(500);
    let out: Output;
    if (failure === 'stop') out = r.accept(r.engine.stop(r.world.now));
    else {
      if (failure === 'glove_disconnected') r.world.connected = false;
      else if (failure === 'camera_lost') r.world.confidence = 0.5;
      else if (failure === 'fault') r.world.tel.st = 'fault';
      else r.world.schedule(r.world.now + 50, failure);
      out = r.step();
    }
    expect(out.commands).toEqual([{ t: 'release' }, { t: 'limit', ma: 900 }]);
    expect(r.engine.state().stage).toBe('aborted');
    expect(r.engine.state().result!.sweeps[0].aborted_at).not.toBeNull();
    expect(r.engine.state().result!.fingers[0].aborted).toBe(true);
  });
  it('handles an empty selection and explicit UTC mapping deterministically', () => {
    const engine = createEvaluationEngine({
      timestamp: (now) => new Date(1700000000000 + now).toISOString(),
    });
    const out = engine.start({ ...one, fingers: [] }, calibration, 500);
    expect(engine.state()).toMatchObject({
      stage: 'done',
      result: {
        friction_used: false,
        started_at: '2023-11-14T22:13:20.500Z',
        ended_at: '2023-11-14T22:13:20.500Z',
      },
    });
    expect(out.commands.at(-1)).toEqual({ t: 'limit', ma: 900 });
  });
});

describe('friction calibration (06-session §5)', () => {
  it('uses the same sweeps, bins raw current to 0.05 and returns only completed curves', () => {
    const engine = frictionRun();
    const r = new EvalRun(engine, one);
    expect(engine.curves()).toEqual({});
    r.until('done');
    const curves = engine.curves().index!;
    expect(curves.map((c) => c.v)).toEqual([0.2, 1]);
    expect(curves[0].points).toHaveLength(21);
    expect(
      curves[0].points.every(
        (p) => Math.abs(p.pos * 20 - Math.round(p.pos * 20)) < 1e-9,
      ),
    ).toBe(true);
    expect(curves[0].points[10].ma).toBeCloseTo(149.6);
    expect(engine.state().result!.friction_used).toBe(false);
    expect(
      engine
        .state()
        .result!.sweeps.every((s) =>
          s.points.every((p) => p.excess_ma === p.ma),
        ),
    ).toBe(true);
  });
  it('excludes aborted sweeps and returns no calibration on a stopped run', () => {
    const engine = frictionRun();
    const r = new EvalRun(engine, one);
    r.until('sweep');
    r.world.schedule(r.world.now + 50, 'overcurrent', 650);
    r.step();
    r.until('done');
    expect(engine.curves()).toEqual({});
    const stopped = frictionRun();
    const s = new EvalRun(stopped, one);
    s.until('sweep');
    stopped.stop(s.world.now);
    expect(stopped.curves()).toEqual({});
  });
});

it('waits two seconds after a sweep and one second released before the next speed', () => {
  const r = new EvalRun(undefined, one);
  r.until('sweep');
  r.until('cooldown');
  for (let i = 0; i < 39; i++) expect(r.step().commands).toEqual([]);
  expect(r.step().commands).toEqual([{ t: 'release' }]);
  expect(r.engine.state().stage).toBe('prepare');
  for (let i = 0; i < 20; i++) expect(r.step().commands).toEqual([]);
  expect(r.step().commands).toEqual([
    { t: 'target', f: [0, 1, 0, 0, 0], v: 1 },
  ]);
});

it('preserves evaluation motion safety over seeded random input sequences', () => {
  let seed = 12345;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const engine = createEvaluationEngine();
  const w = new FakeWorld();
  w.apply(engine.start(one, calibration, 0).commands);
  let targets = 0;
  for (let i = 0; i < 5000; i++) {
    if (engine.state().stage === 'done' || engine.state().stage === 'aborted')
      w.apply(engine.start(one, calibration, w.now).commands);
    const input = w.step(50);
    if (random() < 0.015) input.vision!.confidence = random() * 0.6;
    if (random() < 0.005) input.tel!.st = 'fault';
    if (random() < 0.005) input.gloveConnected = false;
    const out = engine.tick(input);
    if (
      input.vision!.confidence < 0.6 ||
      input.tel!.st === 'fault' ||
      !input.gloveConnected
    ) {
      expect(
        out.commands.every((c) => c.t !== 'target' && c.t !== 'follow'),
      ).toBe(true);
    }
    targets += out.commands.filter((c) => c.t === 'target').length;
    w.apply(out.commands);
  }
  expect(targets).toBeGreaterThan(10);
});
