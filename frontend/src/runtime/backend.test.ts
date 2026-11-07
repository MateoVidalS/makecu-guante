// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../api/client';
import type { CoachDecision, FeelingEntry } from '../contracts/therapist';
import { SimWorld } from '../glove/sim';
import { createGloveController } from '../glove/GloveProvider';
import { createVisionController } from '../vision/VisionProvider';
import { RehabRuntime } from './runtime';
import { calibration as fixture } from '../contracts/fixtures.check';
import {
  DEFAULT_PLAN,
  DEFAULT_EXERCISE_SETTINGS,
  DEFAULT_EVAL_SETTINGS,
} from '../contracts/poses';

let process: ChildProcess;
let directory: string;
let base: string;
const realFetch = globalThis.fetch;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rehab-runtime-'));
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  base = `http://127.0.0.1:${port}`;
  process = spawn(
    'uv',
    [
      'run',
      'python',
      '-m',
      'uvicorn',
      'app.main:app',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    {
      cwd: fileURLToPath(new URL('../../../backend/', import.meta.url)),
      env: {
        ...globalThis.process.env,
        REHAB_DB_PATH: join(directory, 'runtime.db'),
        GEMINI_API_KEY: '',
      },
      stdio: 'ignore',
    },
  );
  let ready = false;
  const startupDeadline = performance.now() + 10_000;
  while (performance.now() < startupDeadline) {
    if (
      await realFetch(`${base}/api/health`)
        .then((r) => r.ok)
        .catch(() => false)
    ) {
      ready = true;
      break;
    }
    if (process.exitCode !== null) throw new Error('Test backend exited');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!ready)
    throw new Error('Test backend did not become ready within 10 seconds');
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) =>
    realFetch(`${base}${input}`, init),
  );
}, 15_000);
afterAll(async () => {
  vi.unstubAllGlobals();
  if (process && process.exitCode === null) {
    const stopped = new Promise<void>((resolve) =>
      process.once('exit', () => resolve()),
    );
    process.kill('SIGTERM');
    await stopped;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
it('stores the simulator plan, traces, evaluation, therapy audit and exports in a real temporary SQLite backend', async () => {
  const calibration = await api.createCalibration({
    servo: fixture.servo,
    camera: {
      ...fixture.camera,
      closed_flex: {
        thumb: 100,
        index: 270,
        middle: 270,
        ring: 270,
        pinky: 270,
      },
    },
    friction: {},
    current_limit_ma: 900,
  });
  const world = new SimWorld({ autoStart: false, seed: 42 });
  const glove = createGloveController({ kind: 'sim', world });
  const vision = createVisionController({
    simSource: world.vision,
    initialKind: 'sim',
  });
  const runtime = new RehabRuntime({ glove, vision });
  try {
    glove.mount();
    await vision.start();
    runtime.mount();
    await runtime.calibration.reload();
    world.advance(200);
    await runtime.exercise.start(DEFAULT_PLAN, DEFAULT_EXERCISE_SETTINGS);
    for (
      let ms = 0;
      ms < 400_000 && runtime.exercise.view().phase !== 'DONE';
      ms += 20
    )
      world.advance(20);
    await runtime.persistence.flush();
    expect(runtime.persistence.store.getState()).toMatchObject({
      status: 'Saved',
      pending: 0,
    });
    const sessions = await api.getSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      calibration_id: calibration.id,
      n_attempts: 15,
      is_demo: true,
    });
    const detail = await api.getSession(sessions[0].id);
    expect(detail.summary).toMatchObject({
      attempts: 15,
      assisted: 9,
      reached_active: 6,
    });
    expect(detail.attempts).toHaveLength(15);
    const trace = await api.getAttemptTrace(detail.attempts[3].id);
    expect(trace.phase).toContain('ASSIST');
    expect(trace.closure.index).toHaveLength(trace.t.length);
    await runtime.evaluation.start(DEFAULT_EVAL_SETTINGS);
    for (
      let ms = 0;
      ms < 100_000 && runtime.evaluation.view().stage !== 'done';
      ms += 20
    )
      world.advance(20);
    await runtime.persistence.flush();
    expect(await api.getEvaluations()).toHaveLength(1);
    expect(await api.getHistoryOverview()).toMatchObject({
      sessions: 1,
      attempts: 15,
      evaluations: 1,
    });
    const exported = await api.exportData('json');
    expect((await exported.text()).length).toBeGreaterThan(1000);

    // Exercise A1's durable queue against A3's actual validation and SQLite storage.
    await runtime.exercise.start(
      [{ pose: 'full_fist', reps: 1 }],
      DEFAULT_EXERCISE_SETTINGS,
    );
    for (
      let ms = 0;
      ms < 20_000 && runtime.exercise.view().phase !== 'ASSIST';
      ms += 20
    )
      world.advance(20);
    expect(runtime.exercise.view().phase).toBe('ASSIST');
    runtime.therapy.recordFeeling({
      pain: 1,
      fatigue: 2,
      note: 'First check-in.',
      source: 'ui',
    });
    runtime.therapy.recordFeeling({
      pain: 2,
      fatigue: 3,
      note: 'Updated check-in.',
      source: 'ui',
    });
    runtime.therapy.adjust(
      'adjust_help',
      { finger: 'index', direction: 'less', reason: 'Gentler help.' },
      'coach',
    );
    runtime.therapy.adjust(
      'set_attempt_time',
      { seconds: 8, reason: 'More time to try.' },
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
    runtime.therapy.adjust('get_live_state', {}, 'coach');
    await runtime.exercise.stop();
    await runtime.persistence.flush();
    expect(runtime.persistence.store.getState()).toMatchObject({
      status: 'Saved',
      pending: 0,
    });
    const id = runtime.exercise.view().sessionId!;
    const audit = await api.request<{
      coach_decisions: CoachDecision[];
      feelings: FeelingEntry[];
    }>(`/sessions/${id}`);
    expect(audit.coach_decisions.map((d) => d.tool)).toEqual([
      'record_feeling',
      'record_feeling',
      'adjust_help',
      'set_attempt_time',
      'brake',
      'record_feeling',
      'get_live_state',
    ]);
    expect(audit.coach_decisions.every((d) => d.session_id === id)).toBe(true);
    expect(audit.coach_decisions[4]).toMatchObject({
      source: 'local_rule',
      applied: { safety_source: 'coach_brake' },
    });
    expect(audit.feelings.map((f) => f.pain)).toEqual([1, 2, 5]);
    expect(audit.feelings.at(-1)).toMatchObject({
      session_id: id,
      attempt_index: 0,
      pain: 5,
      fatigue: 7,
      source: 'ui',
    });
    expect((await api.getSession(id)).attempts[0].safety_events).toContainEqual(
      expect.objectContaining({ source: 'coach_brake' }),
    );
  } finally {
    runtime.dispose();
    vision.stop();
    glove.dispose();
  }
}, 15_000);
