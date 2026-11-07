// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimWorld } from '../glove/sim';
import { createGloveController } from '../glove/GloveProvider';
import { createVisionController } from '../vision/VisionProvider';
import { RehabRuntime } from './runtime';
import { PersistenceQueue, type RuntimeApi } from './persistence';
import * as api from '../api/client';
import { calibration as fixture } from '../contracts/fixtures.check';
import {
  DEFAULT_PLAN,
  DEFAULT_EXERCISE_SETTINGS,
  DEFAULT_EVAL_SETTINGS,
} from '../contracts/poses';
import type { Calibration } from '../contracts/calibration';
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

describe('real runtime integration', () => {
  it('executes the moderate default plan and persists all 15 real attempts in order', async () => {
    const { runtime, world, posts } = await harness();
    const events: EngineEvent[] = [];
    runtime.exercise.onEvent((event) => events.push(event));
    await runtime.exercise.start(DEFAULT_PLAN, DEFAULT_EXERCISE_SETTINGS);
    until(world, () => runtime.exercise.view().phase === 'DONE');
    await runtime.persistence.flush();
    expect(runtime.exercise.view().summary).toMatchObject({
      attempts: 15,
      reached_active: 6,
      assisted: 9,
      interrupted: 0,
    });
    expect(posts.addAttempt).toHaveBeenCalledTimes(15);
    expect(posts.endSession).toHaveBeenCalledTimes(1);
    expect(posts.createSession.mock.calls[0][0]).toMatchObject({
      calibration_id: 1,
      is_demo: true,
    });
    const attempts = posts.addAttempt.mock.calls.map(([body]) => body.result);
    expect(attempts.map((a) => a.index)).toEqual(
      Array.from({ length: 15 }, (_, i) => i),
    );
    expect(attempts.filter((a) => a.assisted)).toHaveLength(9);
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
  it('releases for rigid-index overcurrent, announces safety, and resumes with an interrupted attempt', async () => {
    const { runtime, world } = await harness();
    const events: EngineEvent[] = [];
    runtime.exercise.onEvent((event) => events.push(event));
    await runtime.exercise.start(
      [{ pose: 'full_fist', reps: 2 }],
      DEFAULT_EXERCISE_SETTINGS,
    );
    world.controls.setRigid('index', true);
    until(world, () => runtime.exercise.view().paused);
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'safety',
        source: 'overcurrent',
        finger: 'index',
      }),
    );
    expect(world.firmware.mode).toBe('none');
    world.controls.setRigid('index', false);
    runtime.exercise.resume();
    until(world, () => runtime.exercise.view().phase === 'DONE');
    expect(runtime.exercise.view().summary).toMatchObject({
      attempts: 2,
      interrupted: 1,
    });
  });
  it('restores calibration and the current limit on reconnect and blocks source switches while paused', async () => {
    const { runtime, world, glove, calibration } = await harness();
    await runtime.exercise.start(DEFAULT_PLAN, DEFAULT_EXERCISE_SETTINGS);
    runtime.exercise.pause();
    await expect(runtime.sources.setVision('camera')).rejects.toThrow(
      'End the current session',
    );
    await expect(runtime.sources.setGlove('serial')).rejects.toThrow(
      'End the current session',
    );
    world.controls.unplug();
    world.firmware.calibration = [null, null, null];
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
    await runtime.exercise.start(DEFAULT_PLAN, DEFAULT_EXERCISE_SETTINGS);
    until(world, () => runtime.exercise.view().phase === 'DONE');
    await runtime.persistence.flush();
    expect(runtime.persistence.store.getState()).toMatchObject({
      status: 'Offline',
      pending: 17,
    });
    expect(posts.addAttempt).not.toHaveBeenCalled();
    posts.createSession.mockResolvedValue({ id: 99 } as Awaited<
      ReturnType<RuntimeApi['createSession']>
    >);
    await runtime.persistence.flush();
    expect(posts.addAttempt).toHaveBeenCalledTimes(15);
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
    expect(runtime.evaluation.view().result?.sweeps).toHaveLength(6);
    expect(posts.createEvaluation).toHaveBeenCalledTimes(1);
    expect(posts.createEvaluation.mock.calls[0][0].fingers).toHaveLength(3);
    expect(world.firmware.info().limit).toBe(900);
  });
  it('releases on missing assist vision and latches a camera safety pause', async () => {
    const { runtime, world } = await harness();
    await runtime.exercise.start(
      [{ pose: 'full_fist', reps: 1 }],
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
      plan: DEFAULT_PLAN,
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
  expect(world.firmware.info().limit).toBe(900);
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
  await runtime.exercise.start(DEFAULT_PLAN, DEFAULT_EXERCISE_SETTINGS);
  until(world, () => runtime.exercise.view().phase === 'ATTEMPT');
  const release = vi.spyOn(world.glove, 'release');
  resolve({ ...calibration, id: 2 });
  await reload;
  expect(runtime.calibration.current?.id).toBe(1);
  expect(release).not.toHaveBeenCalled();
});

it('ends an interrupted run before simulator fallback, reconnects, and flags the next run as demo', async () => {
  const { runtime, world, posts } = await harness();
  await runtime.exercise.start(DEFAULT_PLAN, DEFAULT_EXERCISE_SETTINGS);
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
    [{ pose: 'full_fist', reps: 1 }],
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
    [{ pose: 'full_fist', reps: 1 }],
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
    [{ pose: 'full_fist', reps: 1 }],
    DEFAULT_EXERCISE_SETTINGS,
  );
  until(world, () => runtime.exercise.view().phase === 'DONE');
  await runtime.persistence.flush();
  expect(posts.createSession.mock.lastCall?.[0].is_demo).toBe(true);
  expect(posts.endSession).toHaveBeenCalledTimes(2);
});

it('waits for fresh telemetry after Resume instead of reusing a pre-release fault frame', async () => {
  const { runtime, world } = await harness();
  await runtime.exercise.start(DEFAULT_PLAN, DEFAULT_EXERCISE_SETTINGS);
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
