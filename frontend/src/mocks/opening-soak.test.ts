// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import * as api from '../api/client';
import { calibration as fixture, sessions } from '../contracts/fixtures.check';
import {
  type Calibration,
  CURRENT_CAMERA_VIEW,
  CURRENT_FLEX_MODEL,
} from '../contracts/calibration';
import { GLOVE_FINGERS, pullFromClosure } from '../contracts/glove';
import {
  OPEN_ASSIST_PLAN,
  DEFAULT_EXERCISE_SETTINGS,
  MAX_ASSIST_PULL,
} from '../contracts/poses';
import type { EngineEvent, ExercisePlanItem } from '../contracts/engine';
import { createGloveController } from '../glove/GloveProvider';
import { createVisionController } from '../vision/VisionProvider';
import { SimWorld } from '../glove/sim';
import type { PatientPreset } from '../glove/sim/patient';
import { RehabRuntime } from '../runtime/runtime';
import type { RuntimeApi } from '../runtime/persistence';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  vi.restoreAllMocks();
});

async function run(
  preset: PatientPreset,
  plan: ExercisePlanItem[] = OPEN_ASSIST_PLAN,
  tolerance = 0.1,
) {
  const calibration: Calibration = structuredClone(fixture);
  calibration.assist_direction = 'open';
  calibration.current_limit_ma = 2200;
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
  const world = new SimWorld({ autoStart: false, preset, seed: 42 });
  const glove = createGloveController({ world, kind: 'sim' });
  const vision = createVisionController({
    simSource: world.vision,
    initialKind: 'sim',
  });
  const saved: Parameters<RuntimeApi['addAttempt']>[0]['result'][] = [];
  const sink: RuntimeApi = {
    createSession: async (value) => ({ ...sessions[0], ...value, id: 1 }),
    addAttempt: async ({ result }) => {
      saved.push(result);
      return { ...result, id: saved.length, session_id: 1 };
    },
    endSession: async ({ summary }) => ({ ...sessions[0], summary, id: 1 }),
    addCoachDecisions: async () => {},
    addFeelings: async () => {},
    createEvaluation: async (value) => ({ ...value, id: 1, is_demo: true }),
  };
  const runtime = new RehabRuntime({
    glove,
    vision,
    api: sink,
    now: world.timestamp,
  });
  cleanups.push(() => {
    runtime.dispose();
    vision.stop();
    glove.dispose();
  });
  const events: EngineEvent[] = [];
  const commands: { pose: string; f: number[]; closure: number[] }[] = [];
  const target = world.glove.target.bind(world.glove);
  world.glove.target = (f, v) => {
    commands.push({
      pose: runtime.exercise.view().pose.id,
      f: [...f],
      closure: GLOVE_FINGERS.map(
        (finger) => world.vision.latest()?.closure?.[finger] ?? 1,
      ),
    });
    target(f, v);
  };
  let peak = 0;
  world.ticks.subscribe(() => {
    peak = Math.max(peak, world.power.demandMa);
  });
  runtime.exercise.onEvent((e) => events.push(e));
  glove.mount();
  await vision.start();
  runtime.mount();
  await runtime.calibration.reload();
  world.advance(200);
  await runtime.exercise.start(plan, {
    ...DEFAULT_EXERCISE_SETTINGS,
    tolerance,
    assist_max_s: 15,
    hold_s: 5,
  });
  const until = (predicate: () => boolean, budget = 400_000) => {
    for (let ms = 0; !predicate() && ms < budget; ms += 20) world.advance(20);
    expect(predicate()).toBe(true);
  };
  return { runtime, world, saved, events, commands, until, peak: () => peak };
}

it.each(['moderate', 'spastic'] as const)(
  'soaks the real runtime for ten %s attempts with all fingers and safe persisted results',
  async (preset) => {
    // Default practice timing includes the sustained hold, not just motor starts.
    const r = await run(preset, OPEN_ASSIST_PLAN, 0.1);
    r.until(() => ['DONE', 'PAUSED'].includes(r.runtime.exercise.view().phase));
    expect(r.runtime.exercise.view().phase).toBe('DONE');
    await r.runtime.persistence.flush();
    expect(r.saved).toHaveLength(10);
    expect(r.saved.map((a) => a.pose)).toEqual(
      OPEN_ASSIST_PLAN.map((p) => p.pose),
    );
    expect(
      r.saved.filter((a) => a.pose === 'full_fist').every((a) => !a.assisted),
    ).toBe(true);
    expect(
      r.saved.filter((a) => a.pose === 'open').every((a) => a.assisted),
    ).toBe(true);
    expect(
      r.saved.every(
        (a) =>
          a.fingers
            .filter((f) => f.scored)
            .map((f) => f.finger)
            .join() === GLOVE_FINGERS.join(),
      ),
    ).toBe(true);
    expect(r.commands.length).toBeGreaterThan(0);
    expect(
      r.commands.every(
        (c) => c.pose === 'open' && c.f.every((p) => p <= MAX_ASSIST_PULL),
      ),
    ).toBe(true);
    const assisted = new Set(
      r.events.flatMap((e) => (e.kind === 'assist_started' ? e.fingers : [])),
    );
    // The first event may include only the initial stagger group; each finger must also receive opening pull.
    expect(assisted.size).toBeGreaterThan(0);
    for (const i of [0, 1, 2, 3, 4])
      expect(
        r.commands.some((c) => c.f[i] > pullFromClosure(c.closure[i]) + 0.02),
      ).toBe(true);
    expect(r.peak()).toBeLessThan(2200);
    expect(
      r.events.filter((e) => e.kind === 'safety' || e.kind === 'resistance'),
    ).toEqual([]);
    if (preset === 'spastic')
      expect(r.saved.flatMap((a) => a.safety_events)).toContainEqual(
        expect.objectContaining({ source: 'load_shed' }),
      );
    expect(r.world.firmware.position).toEqual([0, 0, 0, 0, 0]);
    expect(r.runtime.persistence.store.getState().status).toBe('Saved');
  },
);

it('detects rigid-index resistance before the independent firmware cut', async () => {
  const r = await run('rigid_index', [{ pose: 'open', reps: 3 }]);
  r.until(() => ['DONE', 'PAUSED'].includes(r.runtime.exercise.view().phase));
  expect(r.runtime.exercise.view().phase).toBe('DONE');
  await r.runtime.persistence.flush();
  expect(r.saved).toHaveLength(3);
  for (const a of r.saved)
    expect(a.safety_events).toContainEqual(
      expect.objectContaining({ source: 'resistance', finger: 'index' }),
    );
  expect(r.events.some((e) => e.kind === 'safety')).toBe(false);
  expect(r.peak()).toBeLessThan(2200);
  expect(r.world.firmware.position).toEqual([0, 0, 0, 0, 0]);
});

it.each(['STOP', 'overcurrent'] as const)(
  '%s during assisted opening pauses the runtime and unwinds to slack',
  async (fault) => {
    const r = await run('moderate', [{ pose: 'open', reps: 1 }]);
    r.until(
      () =>
        r.runtime.exercise.view().phase === 'ASSIST' &&
        r.world.firmware.position.some((p) => p > 0.4),
    );
    if (fault === 'STOP') r.world.controls.pressStop();
    else r.world.glove.limit(100);
    r.until(() => r.runtime.exercise.view().paused, 2000);
    r.world.advance(1000);
    expect(r.events).toContainEqual(
      expect.objectContaining({
        kind: 'safety',
        source: fault === 'STOP' ? 'stop_button' : fault,
      }),
    );
    expect(r.world.firmware.position).toEqual([0, 0, 0, 0, 0]);
    expect(r.world.firmware.attached.every((a) => !a)).toBe(true);
  },
);

it('pays out during a fast voluntary fist in follow without overcurrent', async () => {
  const world = new SimWorld({ autoStart: false, preset: 'spastic', seed: 42 });
  cleanups.push(() => world.stop());
  await world.glove.connect();
  for (const i of [0, 1, 2, 3, 4] as const) world.glove.calib(i, 20, 150);
  world.glove.limit(900);
  world.glove.follow([0.98, 0.98, 0.98, 0.98, 0.98]);
  world.firmware.position.fill(0.9);
  world.servoPosition.fill(0.9);
  world.patient.position.fill(0.1);
  // Drive measured voluntary closure at 2/s, faster than winding at 1.5/s.
  for (let step = 1; step <= 20; step++) {
    const closure = 0.1 + step * 0.04;
    world.patient.position.fill(closure);
    world.glove.follow(
      [closure, closure, closure, closure, closure].map(
        pullFromClosure,
      ) as import('../contracts/glove').Quint,
    );
    world.advance(20);
    expect(world.firmware.state).toBe('run');
    expect(world.power.demandMa).toBeLessThan(900);
    expect(
      world.firmware.position.every((p) => p <= pullFromClosure(closure)),
    ).toBe(true);
  }
});
