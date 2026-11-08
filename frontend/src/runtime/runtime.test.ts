// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimWorld } from '../glove/sim';
import { createGloveController } from '../glove/GloveProvider';
import { createVisionController } from '../vision/VisionProvider';
import { RehabRuntime } from './runtime';
import * as engines from '../engine';
import { PersistenceQueue, type RuntimeApi } from './persistence';
import * as api from '../api/client';
import { calibration as fixture } from '../contracts/fixtures.check';
import {
  OPEN_ASSIST_PLAN,
  DEFAULT_EXERCISE_SETTINGS,
  DEFAULT_EVAL_SETTINGS,
} from '../contracts/poses';
import {
  CURRENT_CAMERA_VIEW,
  CURRENT_FLEX_MODEL,
  type Calibration,
} from '../contracts/calibration';
import type { EngineEvent } from '../contracts/engine';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((f) => f());
  vi.restoreAllMocks();
});
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
// Transport doubles share the real simulator; this does not exercise physical hardware.
function sourceKind<T extends object>(source: T, kind: string): T {
  return new Proxy(source, {
    get(target, key) {
      if (key === 'kind') return kind;
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
async function harness(stubHardware = false) {
  const calibration: Calibration = structuredClone(fixture);
  calibration.assist_direction = 'open';
  calibration.current_limit_ma = 1500;
  calibration.camera.camera_view = CURRENT_CAMERA_VIEW;
  calibration.camera.flex_model = CURRENT_FLEX_MODEL;
  calibration.camera.closed_flex = {
    thumb: 100,
    index: 270,
    middle: 270,
    ring: 270,
    pinky: 270,
  };
  vi.spyOn(api, 'getLatestCalibration').mockResolvedValue(calibration);
  const world = new SimWorld({
    autoStart: false,
    seed: 42,
    preset: 'moderate',
  });
  const glove = createGloveController({
    world,
    kind: stubHardware ? 'serial' : 'sim',
    ...(stubHardware ? { serial: sourceKind(world.glove, 'serial') } : {}),
  });
  const vision = createVisionController({
    simSource: world.vision,
    initialKind: stubHardware ? 'camera' : 'sim',
    ...(stubHardware
      ? { cameraSource: sourceKind(world.vision, 'camera') }
      : {}),
  });
  const posts = {
    createSession: vi
      .fn<RuntimeApi['createSession']>()
      .mockResolvedValue({ id: 41 } as Awaited<
        ReturnType<RuntimeApi['createSession']>
      >),
    addAttempt: vi
      .fn<RuntimeApi['addAttempt']>()
      .mockResolvedValue({} as Awaited<ReturnType<RuntimeApi['addAttempt']>>),
    endSession: vi
      .fn<RuntimeApi['endSession']>()
      .mockResolvedValue({} as Awaited<ReturnType<RuntimeApi['endSession']>>),
    addCoachDecisions: vi.fn().mockResolvedValue(undefined),
    addFeelings: vi.fn().mockResolvedValue(undefined),
    createEvaluation: vi
      .fn<RuntimeApi['createEvaluation']>()
      .mockResolvedValue(
        {} as Awaited<ReturnType<RuntimeApi['createEvaluation']>>,
      ),
  };
  const storage = memoryStorage();
  const runtime = new RehabRuntime({
    glove,
    vision,
    api: posts,
    storage,
    now: world.timestamp,
  });
  glove.mount();
  if (stubHardware) await glove.client.connect();
  await vision.start();
  runtime.mount();
  await runtime.calibration.reload();
  world.advance(200);
  cleanups.push(() => {
    runtime.dispose();
    vision.stop();
    glove.dispose();
  });
  return { runtime, world, glove, vision, posts, calibration, storage };
}
function until(world: SimWorld, predicate: () => boolean, maxMs = 400_000) {
  for (let ms = 0; ms < maxMs && !predicate(); ms += 20) world.advance(20);
  expect(predicate(), 'simulator reached the expected state').toBe(true);
}

describe('calibration from before the five-finger glove', () => {
  it('treats a stored 3-finger servo calibration as "calibration needed"', async () => {
    const { runtime, glove, world, calibration } = await harness();
    const legacy = structuredClone(calibration);
    legacy.servo = legacy.servo.filter((s) =>
      ['thumb', 'index', 'middle'].includes(s.finger),
    );
    vi.spyOn(api, 'getLatestCalibration').mockResolvedValue(legacy);
    await runtime.calibration.reload();
    world.advance(100);
    expect(runtime.calibration.current).toBeNull();
    // Connecting (real or simulated) must not throw "Missing ring servo calibration".
    await expect(glove.client.connect()).resolves.toBeTruthy();
    await expect(
      runtime.exercise.start([{ pose: 'open', reps: 1 }], {} as never),
    ).rejects.toThrow(/Calibrate/);
  });
});

describe('real runtime integration', () => {
  it('executes the moderate opening plan and persists all ten attempts in order', async () => {
    const { runtime, world, posts } = await harness();
    const events: EngineEvent[] = [];
    runtime.exercise.onEvent((event) => events.push(event));
    await runtime.exercise.start(OPEN_ASSIST_PLAN, DEFAULT_EXERCISE_SETTINGS);
    until(world, () => runtime.exercise.view().phase === 'DONE');
    await runtime.persistence.flush();
    expect(runtime.exercise.view().summary).toMatchObject({
      attempts: 10,
      reached_active: 5,
      assisted: 5,
      interrupted: 0,
    });
    expect(posts.addAttempt).toHaveBeenCalledTimes(10);
    expect(posts.endSession).toHaveBeenCalledTimes(1);
    expect(posts.createSession.mock.calls[0][0]).toMatchObject({
      calibration_id: 1,
      is_demo: true,
    });
    const attempts = posts.addAttempt.mock.calls.map(([body]) => body.result);
    expect(attempts.map((a) => a.index)).toEqual(
      Array.from({ length: 10 }, (_, i) => i),
    );
    // Verify transport and persistence independently of the engine's outcome policy.
    expect(attempts).toEqual(
      events.filter((e) => e.kind === 'attempt_done').map((e) => e.result),
    );
    expect(posts.endSession.mock.calls[0][0].summary).toEqual(
      events.find((e) => e.kind === 'session_done')?.summary,
    );
    expect(
      attempts.filter((a) => a.pose === 'full_fist').every((a) => !a.assisted),
    ).toBe(true);
    expect(
      attempts.filter((a) => a.pose === 'open').every((a) => a.assisted),
    ).toBe(true);
    expect(attempts.every((a) => a.trace.t.length > 30)).toBe(true);
    expect(
      attempts.every((a) =>
        a.fingers.filter((f) => f.scored).every((f) => f.active_max !== null),
      ),
    ).toBe(true);
    expect(events.some((e) => e.kind === 'assist_started')).toBe(true);
    expect(world.firmware.state).toBe('idle');
    expect(runtime.diagnosticsStore.getState().visionToCommandP95).toBeLessThan(
      150,
    );
    expect(runtime.diagnosticsStore.getState().commandToEchoP95).not.toBeNull();
    expect(runtime.persistence.store.getState()).toMatchObject({
      status: 'Saved',
      pending: 0,
    });
  });
  it('releases for opening overcurrent, announces safety, and resumes with an interrupted attempt', async () => {
    const { runtime, world } = await harness();
    const events: EngineEvent[] = [];
    runtime.exercise.onEvent((event) => events.push(event));
    await runtime.exercise.start(
      [{ pose: 'open', reps: 2 }],
      DEFAULT_EXERCISE_SETTINGS,
    );
    until(world, () => runtime.exercise.view().phase === 'ASSIST');
    // Exercise runtime fault handling through the real firmware's low-limit cutoff.
    world.glove.limit(100);
    until(world, () => runtime.exercise.view().paused);
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'safety',
        source: 'overcurrent',
      }),
    );
    expect(world.firmware.mode).toBe('none');
    world.glove.limit(1500);
    runtime.exercise.resume();
    until(world, () => runtime.exercise.view().phase === 'DONE');
    expect(runtime.exercise.view().summary).toMatchObject({
      attempts: 2,
      interrupted: 1,
    });
  });
  it('restores calibration and the current limit on reconnect and blocks source switches while paused', async () => {
    const { runtime, world, glove, calibration } = await harness();
    await runtime.exercise.start(OPEN_ASSIST_PLAN, DEFAULT_EXERCISE_SETTINGS);
    runtime.exercise.pause();
    await expect(runtime.sources.setVision('camera')).rejects.toThrow(
      'End the current session',
    );
    await expect(runtime.sources.setGlove('serial')).rejects.toThrow(
      'End the current session',
    );
    world.controls.unplug();
    world.firmware.calibration = [null, null, null, null, null];
    world.glove.limit(100);
    await glove.client.connect();
    expect(world.firmware.info().calib).toEqual(
      calibration.servo.map((s) => [s.min_deg, s.max_deg]),
    );
    expect(world.firmware.info().limit).toBe(calibration.current_limit_ma);
    await runtime.exercise.stop();
    await runtime.sources.setGlove('serial');
    expect(runtime.sources.glove).toBe('serial');
    await runtime.sources.setGlove('sim');
    expect(runtime.sources.glove).toBe('sim');
  });
  it('finishes locally while offline and replays session, attempts and end after recovery', async () => {
    const { runtime, world, posts } = await harness();
    posts.createSession.mockRejectedValue(new Error('offline'));
    await runtime.exercise.start(OPEN_ASSIST_PLAN, DEFAULT_EXERCISE_SETTINGS);
    until(world, () => runtime.exercise.view().phase === 'DONE');
    await runtime.persistence.flush();
    expect(runtime.persistence.store.getState()).toMatchObject({
      status: 'Offline',
    });
    // Automatic safety decisions can add audit jobs alongside the ten attempts.
    expect(runtime.persistence.store.getState().pending).toBeGreaterThanOrEqual(
      OPEN_ASSIST_PLAN.length + 2,
    );
    expect(posts.addAttempt).not.toHaveBeenCalled();
    posts.createSession.mockResolvedValue({ id: 99 } as Awaited<
      ReturnType<RuntimeApi['createSession']>
    >);
    await runtime.persistence.flush();
    expect(posts.addAttempt).toHaveBeenCalledTimes(10);
    expect(
      posts.addAttempt.mock.calls.every(([value]) => value.id === 99),
    ).toBe(true);
    expect(posts.endSession.mock.calls[0][0].id).toBe(99);
    expect(runtime.exercise.view().sessionId).toBe(99);
    expect(runtime.persistence.store.getState().status).toBe('Saved');
  });
  it('evaluates all slow/fast sweeps and restores the exercise current limit', async () => {
    const { runtime, world, posts } = await harness();
    await runtime.evaluation.start(DEFAULT_EVAL_SETTINGS);
    until(world, () => runtime.evaluation.view().stage === 'done');
    await runtime.persistence.flush();
    expect(runtime.evaluation.view().result?.sweeps).toHaveLength(10);
    expect(posts.createEvaluation).toHaveBeenCalledTimes(1);
    expect(posts.createEvaluation.mock.calls[0][0].fingers).toHaveLength(5);
    expect(world.firmware.info().limit).toBe(1500);
  });
  it('releases on missing assist vision and latches a camera safety pause', async () => {
    const { runtime, world } = await harness();
    await runtime.exercise.start(
      [{ pose: 'open', reps: 1 }],
      DEFAULT_EXERCISE_SETTINGS,
    );
    until(world, () => runtime.exercise.view().phase === 'ASSIST');
    world.controls.handOutOfFrame(3000);
    world.advance(500);
    expect(world.firmware.mode).toBe('none');
    world.advance(1000);
    expect(runtime.exercise.view().paused).toBe(true);
  });
});

it('restores durable pending attempts without creating another session', async () => {
  const storage = memoryStorage();
  const posts = {
    createSession: vi.fn().mockResolvedValue({ id: 8 }),
    addAttempt: vi.fn().mockRejectedValue(new Error('offline')),
    endSession: vi.fn(),
    createEvaluation: vi.fn(),
  };
  const queue = new PersistenceQueue(posts, storage);
  queue.enqueue({
    kind: 'session',
    key: 'one',
    value: {
      mode: 'exercise',
      plan: OPEN_ASSIST_PLAN,
      settings: DEFAULT_EXERCISE_SETTINGS,
      calibration_id: 1,
    },
  });
  queue.enqueue({ kind: 'attempt', key: 'one', value: {} as never });
  await queue.flush();
  posts.addAttempt.mockResolvedValue({});
  const restored = new PersistenceQueue(posts, storage);
  await restored.flush();
  expect(posts.createSession).toHaveBeenCalledTimes(1);
  expect(posts.addAttempt.mock.lastCall?.[0].id).toBe(8);
  expect(restored.store.getState()).toMatchObject({
    status: 'Saved',
    pending: 0,
  });
});

it('measures empty-glove friction before any patient calibration and without camera visibility', async () => {
  const { runtime, world, vision, posts } = await harness();
  runtime.calibration.current = null;
  vision.setCalibration(null);
  world.controls.handOutOfFrame(100_000);
  const result = runtime.evaluation.runFriction(['index']);
  until(world, () => runtime.evaluation.view().stage === 'done');
  const curves = await result;
  expect(curves.index).toHaveLength(2);
  expect(curves.index?.every((c) => c.points.length > 10)).toBe(true);
  expect(posts.createEvaluation).not.toHaveBeenCalled();
  expect(world.firmware.info().limit).toBe(1500);
});

it('ignores a late calibration reload while a session is running', async () => {
  const { runtime, world, calibration } = await harness();
  let resolve!: (c: Calibration) => void;
  vi.mocked(api.getLatestCalibration).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const reload = runtime.calibration.reload();
  await runtime.exercise.start(OPEN_ASSIST_PLAN, DEFAULT_EXERCISE_SETTINGS);
  until(world, () => runtime.exercise.view().phase === 'ATTEMPT');
  const release = vi.spyOn(world.glove, 'release');
  resolve({ ...calibration, id: 2 });
  await reload;
  expect(runtime.calibration.current?.id).toBe(1);
  expect(release).not.toHaveBeenCalled();
});

it('ends an interrupted run before simulator fallback, reconnects, and flags the next run as demo', async () => {
  const { runtime, world, posts } = await harness();
  await runtime.exercise.start(OPEN_ASSIST_PLAN, DEFAULT_EXERCISE_SETTINGS);
  until(world, () => runtime.exercise.view().phase === 'ASSIST');
  world.controls.unplug();
  expect(runtime.exercise.view().phase).toBe('PAUSED');
  const before = performance.now();
  await runtime.sources.setGlove('sim');
  await runtime.sources.setVision('sim');
  expect(performance.now() - before).toBeLessThan(5000);
  expect(runtime.exercise.view().phase).toBe('DONE');
  expect(world.glove.connection()).toBe('connected');
  expect(world.firmware.mode).toBe('none');
  await runtime.persistence.flush();
  expect(posts.endSession).toHaveBeenCalledTimes(1);
  await runtime.exercise.start(
    [{ pose: 'open', reps: 1 }],
    DEFAULT_EXERCISE_SETTINGS,
  );
  until(world, () => runtime.exercise.view().phase === 'DONE');
  await runtime.persistence.flush();
  expect(posts.createSession.mock.lastCall?.[0].is_demo).toBe(true);
  expect(runtime.exercise.view().summary?.attempts).toBe(1);
});

it('aborts an evaluation before fallback and does not restart a sweep', async () => {
  const { runtime, world, posts } = await harness();
  await runtime.evaluation.start(DEFAULT_EVAL_SETTINGS);
  until(world, () => runtime.evaluation.view().stage === 'sweep');
  await runtime.sources.setVision('sim');
  expect(runtime.evaluation.view().stage).toBe('aborted');
  expect(world.firmware.mode).toBe('none');
  await runtime.persistence.flush();
  expect(posts.createEvaluation.mock.lastCall?.[0].is_demo).toBe(true);
});

it('releases and replaces real-source transport doubles before starting a flagged demo run', async () => {
  const { runtime, world, glove, vision, posts } = await harness(true);
  expect(runtime.sources.glove).toBe('serial');
  expect(runtime.sources.vision).toBe('camera');
  await runtime.exercise.start(
    [{ pose: 'open', reps: 1 }],
    DEFAULT_EXERCISE_SETTINGS,
  );
  until(world, () => runtime.exercise.view().phase === 'ATTEMPT');
  const release = vi.spyOn(glove.client, 'release');
  await runtime.sources.setGlove('sim');
  expect(release).toHaveBeenCalled();
  expect(glove.client).toBe(world.glove);
  await runtime.sources.setVision('sim');
  expect(vision.source).toBe(world.vision);
  await runtime.persistence.flush();
  expect(posts.createSession.mock.calls[0][0].is_demo).toBe(false);
  expect(posts.endSession).toHaveBeenCalledTimes(1);
  await runtime.exercise.start(
    [{ pose: 'open', reps: 1 }],
    DEFAULT_EXERCISE_SETTINGS,
  );
  until(world, () => runtime.exercise.view().phase === 'DONE');
  await runtime.persistence.flush();
  expect(posts.createSession.mock.lastCall?.[0].is_demo).toBe(true);
  expect(posts.endSession).toHaveBeenCalledTimes(2);
});

it('waits for fresh telemetry after Resume instead of reusing a pre-release fault frame', async () => {
  const { runtime, world } = await harness();
  await runtime.exercise.start(OPEN_ASSIST_PLAN, DEFAULT_EXERCISE_SETTINGS);
  until(world, () => runtime.exercise.view().phase === 'ATTEMPT');
  world.controls.pressStop();
  world.advance(100);
  expect(world.glove.latest()?.st).toBe('fault');
  world.controls.releaseStop();
  runtime.exercise.resume();
  runtime.tick(); // A vision callback can arrive before the next 50 Hz telemetry frame.
  expect(runtime.exercise.view().phase).toBe('RELEASE');
  expect(world.firmware.mode).toBe('none');
  world.advance(1000);
  expect(runtime.exercise.view().phase).toBe('REST');
});

it.each([
  'stop',
  'STOP',
  'unplug',
  'source',
  'dispose',
  'overcurrent',
] as const)(
  'settles empty-glove friction with no curves on %s and preserves aborted stage',
  async (action) => {
    const { runtime, world } = await harness();
    const result = runtime.evaluation.runFriction(['index', 'ring']);
    until(world, () => runtime.evaluation.view().stage === 'sweep');
    if (action === 'stop') await runtime.evaluation.stop();
    else if (action === 'STOP') world.controls.pressStop();
    else if (action === 'unplug') world.controls.unplug();
    else if (action === 'source') await runtime.sources.setVision('sim');
    else if (action === 'dispose') runtime.dispose();
    else {
      world.controls.setRigid('index', true);
      until(world, () => runtime.evaluation.view().stage === 'aborted');
    }
    expect(await result).toEqual({});
    expect(runtime.evaluation.view().stage).toBe('aborted');
    // An unplugged transport cannot deliver release; the firmware watchdog does.
    if (action === 'unplug') world.advance(1100);
    expect(world.firmware.mode).toBe('none');
    world.controls.releaseStop();
  },
);

it('does not acquire the runtime after invalid friction input and ignores missing camera during empty-glove friction', async () => {
  const { runtime, world } = await harness();
  await expect(
    runtime.evaluation.runFriction(['invalid' as never]),
  ).rejects.toThrow('five-finger glove');
  world.controls.handOutOfFrame(100_000);
  const result = runtime.evaluation.runFriction(['ring']);
  until(world, () => runtime.evaluation.view().stage === 'done');
  expect((await result).ring).toHaveLength(2);
});

it('rejects mismatched simulator camera ranges before persisting or starting motion', async () => {
  const { runtime, world, calibration } = await harness();
  const create = vi.spyOn(api, 'createCalibration');
  const invalid = { ...calibration, camera: fixture.camera };
  await expect(runtime.calibration.save(invalid)).rejects.toThrow('over 100%');
  expect(create).not.toHaveBeenCalled();
  runtime.calibration.current = invalid;
  const target = vi.spyOn(world.glove, 'target');
  await expect(
    runtime.exercise.start(OPEN_ASSIST_PLAN, DEFAULT_EXERCISE_SETTINGS),
  ).rejects.toThrow('over 100%');
  expect(target).not.toHaveBeenCalled();
});

it('keeps camera-source frames driving five simulated motors after glove-only fallback', async () => {
  const { runtime, world, vision, posts } = await harness(true);
  await runtime.sources.setGlove('sim');
  expect(runtime.sources.glove).toBe('sim');
  expect(runtime.sources.vision).toBe('camera');
  expect(vision.source.kind).toBe('camera');
  // Camera transport double supplies measured hand motion independently of
  // runtime's simulated-patient phase commands, as a real camera would.
  world.setIntent('open', 'ATTEMPT');
  const targets = vi.spyOn(world.glove, 'target');
  await runtime.exercise.start(
    [{ pose: 'open', reps: 1 }],
    DEFAULT_EXERCISE_SETTINGS,
  );
  until(world, () => runtime.exercise.view().phase === 'ASSIST');
  // O3 schedules assistance per finger; wait for the actual command, not a fixed delay.
  until(world, () => targets.mock.calls.length > 0);
  expect(targets).toHaveBeenCalled();
  expect(targets.mock.calls.every(([pull]) => pull.length === 5)).toBe(true);
  until(world, () => runtime.exercise.view().phase === 'DONE');
  await runtime.persistence.flush();
  expect(runtime.sources.vision).toBe('camera');
  expect(posts.createSession.mock.calls[0][0].is_demo).toBe(true);
  expect(
    posts.addAttempt.mock.calls[0][0].result.fingers.filter((f) => f.scored),
  ).toHaveLength(5);
});

it('exposes therapy, releases immediately on pain, and persists audit and feelings with the eventual session id', async () => {
  const { runtime, world, posts, storage } = await harness();
  const auditPosts = Object.assign(posts, {
    addCoachDecisions: vi.fn().mockResolvedValue(undefined),
    addFeelings: vi.fn().mockResolvedValue(undefined),
  });
  posts.createSession.mockRejectedValue(new Error('offline'));
  await runtime.exercise.start(
    [{ pose: 'open', reps: 2 }],
    DEFAULT_EXERCISE_SETTINGS,
  );
  until(world, () => runtime.exercise.view().phase === 'ASSIST');
  runtime.therapy.adjust(
    'adjust_help',
    { finger: 'index', direction: 'less', reason: 'Gentler help.' },
    'coach',
  );
  runtime.therapy.adjust(
    'set_attempt_time',
    { seconds: 9, reason: 'More time to try.' },
    'coach',
  );
  runtime.therapy.recordFeeling({
    pain: 5,
    fatigue: 7,
    note: 'My hand hurts.',
    source: 'ui',
  });
  expect(runtime.exercise.view().phase).toBe('PAUSED');
  expect(world.firmware.mode).toBe('none');
  world.advance(1000);
  expect(runtime.exercise.view().phase).toBe('PAUSED');
  expect(runtime.therapy.decisions().some((d) => d.tool === 'brake')).toBe(
    true,
  );
  await runtime.exercise.stop();
  await runtime.persistence.flush();
  expect(runtime.persistence.store.getState().status).toBe('Offline');
  expect(auditPosts.addCoachDecisions).not.toHaveBeenCalled();

  // Reloaded queues retain audits and remap the offline placeholder to SQLite's real id.
  auditPosts.createSession.mockResolvedValue({ id: 99 } as Awaited<
    ReturnType<RuntimeApi['createSession']>
  >);
  const restored = new PersistenceQueue(auditPosts, storage);
  await restored.flush();
  expect(restored.store.getState()).toMatchObject({
    pending: 0,
    status: 'Saved',
  });
  expect(auditPosts.addCoachDecisions).toHaveBeenCalledTimes(4);
  expect(
    auditPosts.addCoachDecisions.mock.calls.every(
      ([id, decisions]) =>
        id === 99 &&
        decisions.every((d: { session_id: number }) => d.session_id === 99),
    ),
  ).toBe(true);
  expect(auditPosts.addFeelings).toHaveBeenCalledWith(99, [
    expect.objectContaining({
      session_id: 99,
      pain: 5,
      fatigue: 7,
      attempt_index: 0,
    }),
  ]);
  const attempt = posts.addAttempt.mock.calls[0][0].result;
  expect(attempt.safety_events).toContainEqual(
    expect.objectContaining({ source: 'coach_brake' }),
  );
  expect(attempt.interrupted).toBe(true);
});

it('therapy brake cancels evaluation and friction without raising the lower current limit or restarting motion', async () => {
  const { runtime, world } = await harness();
  await runtime.evaluation.start(DEFAULT_EVAL_SETTINGS);
  until(world, () => runtime.evaluation.view().stage === 'sweep');
  const target = vi.spyOn(world.glove, 'target');
  const limit = vi.spyOn(world.glove, 'limit');
  runtime.therapy.brake('Stop all movement.', 'local_rule');
  expect(runtime.evaluation.view().stage).toBe('aborted');
  expect(world.firmware.mode).toBe('none');
  expect(limit).not.toHaveBeenCalled();
  world.advance(2000);
  expect(target).not.toHaveBeenCalled();
  expect(world.firmware.info().limit).toBe(600);

  const friction = runtime.evaluation.runFriction(['index']);
  until(world, () => runtime.evaluation.view().stage === 'sweep');
  limit.mockClear();
  target.mockClear();
  runtime.therapy.brake('Stop the measurement.', 'patient_ui');
  expect(await friction).toEqual({});
  expect(limit).not.toHaveBeenCalled();
  world.advance(2000);
  expect(target).not.toHaveBeenCalled();
  expect(world.firmware.mode).toBe('none');
});

it('resets therapy limits, feelings, undo and rate limits between sessions without reusing audit session ids', async () => {
  const { runtime, world, posts } = await harness();
  const audit = Object.assign(posts, {
    addCoachDecisions: vi.fn().mockResolvedValue(undefined),
    addFeelings: vi.fn().mockResolvedValue(undefined),
  });
  await runtime.exercise.start(
    [{ pose: 'open', reps: 1 }],
    DEFAULT_EXERCISE_SETTINGS,
  );
  await runtime.persistence.flush();
  runtime.therapy.adjust('add_rest', { seconds: 20, reason: 'Rest.' }, 'coach');
  runtime.therapy.recordFeeling({
    pain: 1,
    fatigue: 2,
    note: 'Okay.',
    source: 'voice',
  });
  await runtime.exercise.stop();
  await runtime.persistence.flush();
  audit.createSession.mockResolvedValue({ id: 88 } as Awaited<
    ReturnType<RuntimeApi['createSession']>
  >);
  await runtime.exercise.start(
    [{ pose: 'hook', reps: 1 }],
    DEFAULT_EXERCISE_SETTINGS,
  );
  await runtime.persistence.flush();
  expect(runtime.therapy.decisions()).toEqual([]);
  expect(runtime.therapy.feelings()).toEqual([]);
  expect(runtime.therapy.undo()).toBeNull();
  expect(runtime.therapy.state()?.adjustments).toMatchObject({
    attempt_s: 6,
    extra_rest_s: 0,
    next_pose: null,
  });
  runtime.therapy.adjust(
    'adjust_help',
    { finger: 'index', direction: 'less', reason: 'Gentler.' },
    'coach',
  );
  await runtime.persistence.flush();
  expect(audit.addCoachDecisions.mock.lastCall?.[0]).toBe(88);
  expect(runtime.therapy.decisions().at(-1)?.session_id).toBe(88);
  until(world, () => runtime.exercise.view().phase === 'ATTEMPT');
});

it.each([undefined, 'close'] as const)(
  'never sends legacy %s ranges or starts motion with them',
  async (assist_direction) => {
    const { runtime, world, calibration } = await harness();
    const calib = vi.spyOn(world.glove, 'calib');
    vi.mocked(api.getLatestCalibration).mockResolvedValue({
      ...calibration,
      assist_direction,
    });
    await runtime.calibration.reload();
    await runtime.calibration.sendToGlove();
    expect(calib).not.toHaveBeenCalled();
    await expect(
      runtime.exercise.start(OPEN_ASSIST_PLAN, DEFAULT_EXERCISE_SETTINGS),
    ).rejects.toThrow('The glove now helps the hand open. Calibrate it again.');
    await expect(
      runtime.evaluation.start(DEFAULT_EVAL_SETTINGS),
    ).rejects.toThrow('The glove now helps the hand open. Calibrate it again.');
  },
);
it('always saves the current opening direction even if the caller supplies a legacy value', async () => {
  const { runtime, calibration } = await harness();
  const create = vi
    .spyOn(api, 'createCalibration')
    .mockImplementation(async (value) => ({
      ...value,
      id: 2,
      created_at: calibration.created_at,
    }));
  await runtime.calibration.save({ ...calibration, assist_direction: 'close' });
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ assist_direction: 'open' }),
  );
  expect(runtime.calibration.current?.assist_direction).toBe('open');
});

it('passes the changing active current limit to the engine, including evaluation and recalibration', async () => {
  const create = vi.spyOn(engines, 'createExerciseEngine');
  const { runtime, world, calibration } = await harness();
  const options = create.mock.calls[0][0]!;
  expect(options.currentLimitMa).toBe(world.firmware.info().limit);
  await runtime.evaluation.start(DEFAULT_EVAL_SETTINGS);
  expect(options.currentLimitMa).toBe(600);
  expect(options.currentLimitMa).toBe(world.firmware.info().limit);
  await runtime.evaluation.stop();
  expect(options.currentLimitMa).toBe(1500);
  vi.spyOn(api, 'createCalibration').mockImplementation(async (value) => ({
    ...value,
    id: 2,
    created_at: calibration.created_at,
  }));
  await runtime.calibration.save({ ...calibration, current_limit_ma: 1200 });
  expect(options.currentLimitMa).toBe(1200);
  expect(options.currentLimitMa).toBe(world.firmware.info().limit);
});
