// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../api/client';
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
  for (let tries = 0; tries < 100; tries++) {
    if (
      await realFetch(`${base}/api/health`)
        .then((r) => r.ok)
        .catch(() => false)
    )
      break;
    if (process.exitCode !== null) throw new Error('Test backend exited');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
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
it('stores the simulator plan, traces, evaluation and exports in a real temporary SQLite backend', async () => {
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
  } finally {
    runtime.dispose();
    vision.stop();
    glove.dispose();
  }
}, 15_000);
