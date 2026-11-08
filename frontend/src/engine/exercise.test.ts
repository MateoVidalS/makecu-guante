import { describe, expect, it } from 'vitest';
import type { EngineInput } from './types';
import {
  GLOVE_FINGERS,
  pullFromClosure,
  closureFromPull,
  type Quint,
} from '../contracts/glove';
import {
  DEFAULT_EXERCISE_SETTINGS,
  OPEN_ASSIST_PLAN,
  TENDON_GLIDE_PLAN,
  POSES,
} from '../contracts/poses';
import { createExerciseEngine } from './exercise';
import { calibration } from './test/fakeWorld';
import { Run } from './test/exerciseRun';

it('waits for 500 ms visibility and re-prompts every 8 seconds without moving', () => {
  const r = new Run();
  r.world.confidence = 0.59;
  for (let i = 0; i < 180; i++) r.step();
  expect(r.engine.state().phase).toBe('PRESENT');
  expect(
    r.events.filter((e) => e.kind === 'phase' && e.phase === 'PRESENT'),
  ).toHaveLength(2);
  expect(
    r.outputs.flatMap((o) => o.commands).every((c) => c.t === 'release'),
  ).toBe(true);
  r.world.confidence = 0.6;
  r.step(400);
  r.step(450);
  expect(r.engine.state().phase).toBe('PRESENT');
  r.step(50);
  expect(r.engine.state().phase).toBe('ATTEMPT');
});

it('actively reaches and holds with mapped follow only, recording best opening and final closure', () => {
  const r = new Run('open', { attempt_s: 6 });
  r.until('ATTEMPT');
  r.world.hand = [0.05, 0.05, 0.05, 0.05, 0.05];
  const out = r.step();
  expect(out.commands).toEqual([
    { t: 'follow', f: r.world.hand.map(pullFromClosure) },
  ]);
  r.until('HOLD');
  r.world.hand = [0.4, 0.4, 0.4, 0.4, 0.4];
  r.until('DONE');
  expect(r.targets()).toEqual([]);
  expect(r.results()[0]).toMatchObject({
    reached_active: true,
    reached_final: true,
    assisted: false,
    active_ratio: 0.95,
    current_mean_ma: null,
  });
  expect(r.results()[0].fingers[1]).toMatchObject({
    active_max: 0.05,
    assist_needed: 0,
    final: 0.4,
  });
  expect(r.results()[0].trace.phase.at(-1)).toBe('RELEASE');
});

it('never targets a closing deficit and skips ASSIST without claiming reach', () => {
  const r = new Run('full_fist');
  r.world.hand = [0.3, 0.4, 0.4, 0.4, 0.4];
  r.until('DONE');
  expect(r.targets()).toEqual([]);
  expect(
    r.events.filter((e) => e.kind === 'phase').map((e) => e.phase),
  ).toEqual(['PRESENT', 'ATTEMPT', 'RELEASE', 'REST', 'DONE']);
  expect(r.results()[0]).toMatchObject({
    assisted: false,
    reached_final: false,
  });
  expect(r.results()[0].fingers.every((f) => f.assist_needed === 0)).toBe(true);
});

it('assists only an opening deficit and keeps free, reached and queued fingers from raising pull', () => {
  const r = new Run('open');
  r.world.hand = [0.05, 0.9, 0.05, 0.05, 0.05];
  r.until('ASSIST');
  const target = r.targets()[0];
  expect(target.f[1]).toBeCloseTo(0.95);
  for (const i of [0, 2, 3, 4])
    expect(target.f[i]).toBeLessThanOrEqual(r.world.tel.a[i]);
  expect(r.events).toContainEqual(
    expect.objectContaining({
      kind: 'assist_started',
      fingers: ['index'],
      from: [0.05, 0.9, 0.05, 0.05, 0.05],
    }),
  );
  const started = r.events.find((e) => e.kind === 'assist_started');
  if (started?.kind === 'assist_started')
    expect(
      started.to.every((v) => Math.abs(v - closureFromPull(0.95)) < 1e-6),
    ).toBe(true);
  r.world.hand = [0.7, 0.6, 0.05, 0.05, 0.05];
  r.step(50);
  expect(r.world.tel.tg![0]).toBeLessThanOrEqual(pullFromClosure(0.7) - 0.08);
  expect(r.world.tel.tg![2]).toBeLessThanOrEqual(r.world.tel.a[2]);
  r.world.hand = [0.05, 0.05, 0.05, 0.05, 0.05];
  r.until('DONE');
  expect(r.results()[0]).toMatchObject({
    assisted: true,
    reached_final: true,
    time_to_position_s: null,
  });
  expect(r.results()[0].fingers[1].assist_needed).toBeCloseTo(0.9);
});

it('uses decreasing closure to detect opening plateaus and honors observation mode', () => {
  const r = new Run('open', { attempt_s: 20, plateau_s: 1 });
  r.until('ATTEMPT');
  for (let i = 1; i <= 20; i++) {
    r.world.hand[4] = 0.95 - i * 0.04;
    r.step(200);
  }
  expect(r.engine.state().phase).toBe('ATTEMPT');
  const at = r.world.now;
  r.until('ASSIST');
  expect(r.world.now - at).toBeGreaterThanOrEqual(1000);
  const observation = new Run('open', { assist_enabled: false });
  observation.until('DONE');
  expect(observation.targets()).toEqual([]);
});

it('settles for one second at capped pull, or ends at the assist time limit without visual reach', () => {
  const r = new Run('open', { assist_max_s: 15 });
  r.until('ASSIST');
  let peak = 0;
  while (r.engine.state().phase === 'ASSIST') {
    r.step();
    const moving = r.world.tel.a.filter(
      (v, i) => r.world.tel.tg![i] > v + 1e-6,
    ).length;
    peak = Math.max(peak, moving);
    expect(moving).toBeLessThanOrEqual(3);
  }
  expect(peak).toBe(3);
  expect(r.world.tel.a.every((a) => Math.abs(a - 0.95) <= 0.02)).toBe(true);
  const at = r.world.now;
  r.until('DONE');
  expect(r.results()[0].reached_final).toBe(false);
  expect(r.results()[0].trace.t.at(-1)! * 1000).toBeGreaterThan(1000);
  expect(at).toBeLessThan(14000);
  const cap = new Run('open', { assist_max_s: 0.2 });
  cap.until('ASSIST');
  const start = cap.world.now;
  cap.until('ASSIST_HOLD');
  expect(cap.world.now - start).toBe(200);
});

it('accepts assisted opening within the calibrated cap, and retains pinch gating', () => {
  const r = new Run();
  r.until('ASSIST');
  r.world.hand = [0.14, 0.14, 0.14, 0.14, 0.14];
  r.until('ASSIST_HOLD');
  r.until('DONE');
  expect(r.results()[0].reached_final).toBe(true);
  const pinch = new Run('pinch', { attempt_s: 6 });
  pinch.world.hand = [0.5, 0.55, 0, 0, 0];
  pinch.world.pinch = 0.15;
  pinch.until('ATTEMPT');
  for (let i = 0; i < 15; i++) pinch.step();
  expect(pinch.engine.state().phase).toBe('ATTEMPT');
  pinch.world.pinch = 0.12;
  pinch.until('DONE');
  expect(pinch.results()[0]).toMatchObject({
    reached_active: true,
    pinch_min: 0.12,
  });
});

it('throttles follow by frame identity and progress to 2 Hz per finger', () => {
  const r = new Run('open', { attempt_s: 6 });
  r.until('ATTEMPT');
  const input = r.world.step();
  r.accept(r.engine.tick(input));
  expect(r.engine.tick(input).commands).toEqual([]);
  const times = new Map<string, number>();
  for (let i = 0; i < 30; i++) {
    r.world.hand = [0.8 - i * 0.01, 0.8 - i * 0.01, 0.8, 0.8, 0.8];
    for (const e of r.step().events)
      if (e.kind === 'progress') {
        if (times.has(e.finger))
          expect(r.world.now - times.get(e.finger)!).toBeGreaterThanOrEqual(
            500,
          );
        times.set(e.finger, r.world.now);
      }
  }
  expect(times.size).toBeGreaterThanOrEqual(2);
});

describe.each(['ATTEMPT', 'ASSIST'] as const)(
  '%s reach dwell gaps',
  (phase) => {
    const prepare = () => {
      const r = new Run('open', { attempt_s: phase === 'ASSIST' ? 0.1 : 6 });
      r.until('ATTEMPT');
      const attemptAt = r.world.now;
      r.until(phase);
      r.world.hand = [0, 0, 0, 0, 0];
      r.step();
      return { r, attemptAt, dwellAt: r.world.now };
    };
    const hold = phase === 'ATTEMPT' ? 'HOLD' : 'ASSIST_HOLD';
    const expectReached = (r: Run, tRel: number) => {
      expect(r.engine.state().phase).toBe(hold);
      expect(
        r.outputs
          .at(-1)!
          .commands.every(
            (c) =>
              c.t !== 'target' || c.f.every((v, i) => v <= r.world.tel.a[i]),
          ),
      ).toBe(true);
      expect(r.events).toContainEqual({
        kind: 'reached',
        assisted: phase === 'ASSIST',
        t_rel: tRel,
      });
    };

    it.each([50, 199, 200])(
      'preserves the dwell across a %i ms gap, excluding its time from progress and metrics',
      (gap) => {
        const { r, attemptAt, dwellAt } = prepare();
        r.step(200);
        r.world.detected = false;
        expect(r.step(50).commands).toEqual([]);
        r.world.detected = true;
        r.step(gap);
        r.step(249);
        expect(r.engine.state().phase).toBe(phase);
        r.step(1);
        expect(r.world.now - dwellAt).toBe(500 + gap);
        const tRel = (dwellAt - attemptAt) / 1000;
        expectReached(r, tRel);
        r.until('DONE');
        expect(r.results()[0].time_to_position_s).toBe(
          phase === 'ATTEMPT' ? tRel : null,
        );
      },
    );

    it.each([false, true])(
      'resets a gap longer than 200 ms (intermediate invisible tick: %s)',
      (intermediate) => {
        const { r, attemptAt } = prepare();
        r.step(50);
        r.world.detected = false;
        r.step(50);
        if (intermediate) r.step(201);
        r.world.detected = true;
        r.step(intermediate ? 1 : 201);
        const restartedAt = r.world.now;
        r.step(499);
        expect(r.engine.state().phase).toBe(phase);
        r.step(1);
        expectReached(r, (restartedAt - attemptAt) / 1000);
      },
    );

    it('resets immediately on a visible unsatisfied frame, including after a short gap', () => {
      const { r, attemptAt } = prepare();
      r.step(400);
      r.world.detected = false;
      r.step(50);
      r.world.detected = true;
      r.world.hand[1] = 0.8;
      r.step(100);
      r.world.hand[1] = 0;
      r.step(50);
      const restartedAt = r.world.now;
      r.step(499);
      expect(r.engine.state().phase).toBe(phase);
      r.step(1);
      expectReached(r, (restartedAt - attemptAt) / 1000);
    });

    it.each(['missing', 'low confidence', 'stale', 'null'] as const)(
      'cannot complete on an invisible input (%s), even at the dwell deadline',
      (kind) => {
        const { r, attemptAt, dwellAt } = prepare();
        r.step(450);
        const unseen = (input: EngineInput) => {
          if (kind === 'missing') {
            input.vision!.detected = false;
            input.vision!.closure = null;
          } else if (kind === 'low confidence') input.vision!.confidence = 0.59;
          else if (kind === 'stale') input.vision!.t -= 301;
          else input.vision = null;
        };
        for (const ms of [50, 100, 100]) {
          expect(r.step(ms, unseen).commands).toEqual([]);
          expect(r.engine.state().phase).toBe(phase);
          expect(r.events.some((e) => e.kind === 'reached')).toBe(false);
        }
        r.step(0);
        expectReached(r, (dwellAt - attemptAt) / 1000);
      },
    );

    it('excludes each of multiple short gaps without moving the successful window start', () => {
      const { r, attemptAt, dwellAt } = prepare();
      for (let i = 0; i < 2; i++) {
        r.step(100);
        r.world.detected = false;
        r.step(50);
        r.world.detected = true;
        r.step(150);
      }
      r.step(199);
      expect(r.engine.state().phase).toBe(phase);
      r.step(1);
      expect(r.world.now - dwellAt).toBe(800);
      expectReached(r, (dwellAt - attemptAt) / 1000);
    });
  },
);

describe('exercise safety', () => {
  it.each([
    'stop_button',
    'watchdog',
    'overcurrent',
    'disconnect',
    'fault',
  ] as const)('%s releases and latches pause', (failure) => {
    const r = new Run();
    r.until('ASSIST');
    if (failure === 'disconnect') r.world.connected = false;
    else if (failure === 'fault') r.world.tel.st = 'fault';
    else r.world.schedule(r.world.now + 50, failure, 950);
    expect(r.step().commands).toEqual([{ t: 'release' }]);
    expect(r.engine.state().phase).toBe('PAUSED');
    expect(r.step().commands).toEqual([]);
    expect(r.accept(r.engine.resume(r.world.now)).commands[0]).toEqual({
      t: 'release',
    });
    r.world.connected = true;
    r.until('DONE');
    expect(r.results()[0].interrupted).toBe(true);
  });
  it('attributes overcurrent using pull minus mapped vision in the last 300 ms', () => {
    const r = new Run();
    r.until('ASSIST');
    r.step(50, (input) => {
      input.tel!.a = [0.1, 0.7, 0.3, 0.3, 0.3];
    });
    r.world.schedule(r.world.now + 50, 'overcurrent', 950);
    r.step();
    expect(r.events).toContainEqual({
      kind: 'safety',
      source: 'overcurrent',
      finger: 'index',
      ma: 950,
    });
  });
  it('delivers a delayed fault event once after telemetry paused the engine', () => {
    const r = new Run();
    r.until('ATTEMPT');
    r.step(50, (input) => {
      input.tel!.st = 'fault';
    });
    const input = r.world.step();
    input.gloveEvents = [{ t: input.now, e: 'watchdog' }];
    expect(
      r.accept(r.engine.tick(input)).events.filter((e) => e.kind === 'safety'),
    ).toHaveLength(1);
    expect(r.engine.tick(input).events).toEqual([]);
  });
  it.each(['ASSIST', 'ASSIST_HOLD'] as const)(
    'releases after 300 ms unseen in %s and pauses at 1 s',
    (phase) => {
      const r = new Run('open', { assist_max_s: 0.5, hold_s: 5 });
      r.until(phase);
      r.world.confidence = 0;
      r.step();
      const at = r.world.now;
      for (let i = 0; i < 5; i++) expect(r.step().commands).toEqual([]);
      expect(r.step().commands).toEqual([{ t: 'release' }]);
      r.until('PAUSED');
      expect(r.world.now - at).toBe(1000);
      expect(r.events).toContainEqual({
        kind: 'safety',
        source: 'camera_lost',
        finger: null,
        ma: null,
      });
    },
  );
  it('requires resume after vision released, and suppresses motion at low confidence', () => {
    const r = new Run();
    r.until('ASSIST');
    r.world.detected = false;
    for (let i = 0; i < 7; i++) r.step();
    r.world.detected = true;
    expect(r.step().commands).toEqual([{ t: 'release' }]);
    expect(r.engine.state().phase).toBe('PAUSED');
    const attempt = new Run();
    attempt.until('ATTEMPT');
    attempt.world.confidence = 0;
    expect(attempt.step().commands).toEqual([]);
  });
  it.each(['pause', 'skip', 'stop'] as const)(
    'records %s as interrupted and releases immediately',
    (action) => {
      const r = new Run();
      r.until('ATTEMPT');
      expect(r.accept(r.engine[action](r.world.now)).commands[0]).toEqual({
        t: 'release',
      });
      if (action === 'pause') r.accept(r.engine.resume(r.world.now));
      r.until('DONE');
      expect(r.results()).toHaveLength(1);
      expect(r.results()[0].interrupted).toBe(true);
      expect(r.engine.stop(r.world.now).events).toEqual([]);
    },
  );
});

it.each([[OPEN_ASSIST_PLAN], [TENDON_GLIDE_PLAN]])(
  'completes a whole plan, with closing deficits unassisted',
  (plan) => {
    const r = new Run(
      'open',
      {
        ...DEFAULT_EXERCISE_SETTINGS,
        present_s: 0,
        attempt_s: 1,
        hold_s: 0.1,
        rest_s: 0,
      },
      {},
      plan,
    );
    for (let i = 0; i < 15000 && r.engine.state().phase !== 'DONE'; i++) {
      const pose = r.engine.state().pose;
      if (pose === 'open') {
        r.world.hand = (
          r.engine.state().phase === 'ASSIST'
            ? r.world.tel.a.map(closureFromPull)
            : [0.6, 0.6, 0.6, 0.6, 0.6]
        ) as Quint;
      } else
        r.world.hand = GLOVE_FINGERS.map(
          (f) => (POSES[pose].closure[f] ?? 0) * 0.5,
        ) as Quint;
      r.step();
    }
    expect(r.engine.state().phase).toBe('DONE');
    expect(r.results()).toHaveLength(
      plan.reduce((n, item) => n + item.reps, 0),
    );
    expect(
      r
        .results()
        .filter((a) => a.pose !== 'open')
        .every((a) => !a.assisted),
    ).toBe(true);
    if (plan === OPEN_ASSIST_PLAN) expect(r.results()).toHaveLength(10);
  },
);

it('rejects settings that weaken stagger, concurrency or current policy', () => {
  for (const override of [
    { assist_stagger_ms: 149 },
    { assist_stagger_ms: NaN },
    { assist_max_parallel: 0 },
    { assist_max_parallel: 4 },
    { assist_max_parallel: 1.5 },
  ])
    expect(() => new Run('open', override)).toThrow();
  expect(() =>
    createExerciseEngine({ currentLimitMa: NaN }).start(
      [{ pose: 'open', reps: 1 }],
      DEFAULT_EXERCISE_SETTINGS,
      calibration,
      0,
    ),
  ).toThrow();
});

it('cannot replay a prior target if an assist times out without safe telemetry', () => {
  const r = new Run('open', { assist_max_s: 0.1, hold_s: 2 });
  r.until('ASSIST');
  r.accept(r.engine.stop(r.world.now));
  r.accept(
    r.engine.start(
      [{ pose: 'open', reps: 1 }],
      {
        ...DEFAULT_EXERCISE_SETTINGS,
        present_s: 0,
        attempt_s: 0.1,
        assist_max_s: 0.1,
        hold_s: 2,
      },
      calibration,
      r.world.now,
    ),
  );
  r.until('ATTEMPT');
  while (r.engine.state().phase !== 'ASSIST_HOLD')
    r.step(50, (input) => {
      input.tel = null;
    });
  const count = r.targets().length;
  r.step();
  expect(r.targets()).toHaveLength(count);
  expect(r.engine.hasAssistance()).toBe(false);
});

it('preserves the stagger and three winding slots across early ATTEMPT assistance and ASSIST', () => {
  const r = new Run('open', { attempt_s: 1, assist_max_s: 6 });
  r.until('ATTEMPT');
  r.step(900);
  expect(
    r.engine.therapy.adjust(
      'assist_finger_now',
      { finger: 'index', reason: 'Help opening now.' },
      'coach',
    ).result,
  ).toBe('applied');
  expect(r.targets()).toHaveLength(1);
  r.step(100);
  expect(r.engine.state().phase).toBe('ASSIST');
  expect(r.targets()).toHaveLength(1);
  r.step(50);
  expect(r.targets()).toHaveLength(2);
  for (let i = 0; i < 10; i++) r.step();
  expect(
    r.world.tel.a.filter((a, i) => r.world.tel.tg![i] > a + 1e-6),
  ).toHaveLength(3);
});
it('preserves the motion safety property over seeded random inputs and lifecycle actions', () => {
  let seed = 0x4ab123;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const r = new Run('open', { attempt_s: 0.3 });
  const phases = new Set<string>();
  for (let i = 0; i < 20000; i++) {
    if (r.engine.state().phase === 'DONE')
      r.accept(
        r.engine.start(
          [{ pose: 'open', reps: 2 }],
          { ...DEFAULT_EXERCISE_SETTINGS, present_s: 0, attempt_s: 0.3 },
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
