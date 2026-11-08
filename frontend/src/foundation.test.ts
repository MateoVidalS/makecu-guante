import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as fixtures from './contracts/fixtures.check';
import {
  POSES,
  DEFAULT_PLAN,
  DEFAULT_EXERCISE_SETTINGS,
  DEFAULT_EVAL_SETTINGS,
  calibratedPinch,
} from './contracts/poses';
import { ScriptedRuntime } from './runtime/ScriptedRuntime';
import { createExerciseEngine, createEvaluationEngine } from './engine';
import { StubGlove } from './glove';
import { StubVision } from './vision';
import type { EngineEvent } from './contracts/engine';
import type { Runtime } from './contracts/runtime';
import {
  CURRENT_ASSIST_DIRECTION,
  type Calibration,
} from './contracts/calibration';
import { tokens } from './styles/tokens';
import { server } from './mocks/server';
import { mockState, resetMocks } from './mocks/handlers';
import * as api from './api/client';

const nativeFetch = globalThis.fetch;
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  const interceptedFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    interceptedFetch(
      typeof input === 'string'
        ? new URL(input, window.location.origin)
        : input,
      init,
    ),
  );
});
beforeEach(resetMocks);
afterEach(() => vi.useRealTimers());
afterAll(() => {
  server.close();
  vi.stubGlobal('fetch', nativeFetch);
});

describe('shared contracts', () => {
  it('keeps compile-time checked literals identical to JSON fixtures', () => {
    for (const [name, data] of Object.entries(fixtures)) {
      const disk = JSON.parse(
        readFileSync(
          resolve(process.cwd(), '..', 'contracts', 'fixtures', `${name}.json`),
          'utf8',
        ),
      );
      // The frozen literal remains a valid legacy calibration; O5 marks the JSON as open.
      const expected =
        name === 'calibration'
          ? ({
              ...fixtures.calibration,
              assist_direction: CURRENT_ASSIST_DIRECTION,
            } satisfies Calibration)
          : data;
      expect(expected).toEqual(disk);
    }
  });
  it('exports the exact poses, default plans, and patient-specific pinch threshold', () => {
    expect(DEFAULT_PLAN.reduce((n, p) => n + p.reps, 0)).toBe(8);
    expect(DEFAULT_PLAN.map((p) => p.pose)).toEqual([
      'full_fist',
      'open',
      'thumbs_up',
      'point',
      'peace',
      'pinky_up',
      'full_fist',
      'open',
    ]);
    // Finger by finger: raised fingers open, the others stay closed.
    expect(POSES.point.raise).toEqual(['index']);
    expect(POSES.point.closure).toEqual({
      thumb: null,
      index: 0,
      middle: 0.8,
      ring: 0.8,
      pinky: 0.8,
    });
    expect(POSES.peace.raise).toEqual(['index', 'middle']);
    expect(POSES.thumbs_up.closure.thumb).toBe(0);
    expect(POSES.pinky_up.closure.pinky).toBe(0);
    expect(POSES.hook.closure.thumb).toBeNull();
    expect(POSES.hook.render.index).toEqual({ mcp: 0, pip: 90, dip: 70 });
    expect(POSES.tabletop.render.index).toEqual({ mcp: 90, pip: 0, dip: 0 });
    expect(POSES.full_fist.closure).toEqual({
      thumb: 0.7,
      index: 0.95,
      middle: 0.95,
      ring: 0.95,
      pinky: 0.95,
    });
    expect(calibratedPinch(0.2).pinch!.max_ratio).toBeCloseTo(0.26);
  });
  it('exposes safe initial states from the implemented engines', () => {
    expect(createExerciseEngine().state().phase).toBe('DONE');
    expect(createEvaluationEngine().state().stage).toBe('idle');
  });
});

describe('MSW REST client', () => {
  it('covers health, profile, and calibration reads and writes', async () => {
    expect((await api.getHealth()).ok).toBe(true);
    expect(await api.getProfile()).toEqual(mockState.profile);
    const profile = { ...fixtures.profile, pseudonym: 'Alex' };
    await api.putProfile(profile);
    expect(await api.getProfile()).toEqual(profile);
    const { id: _id, created_at: _date, ...input } = fixtures.calibration;
    const saved = await api.createCalibration(input);
    expect(saved.id).toBe(3);
    expect(await api.getLatestCalibration()).toEqual(saved);
    expect(await api.getCalibrations()).toHaveLength(3);
  });
  it('keeps mock directions and overview comparisons aligned with calibration', async () => {
    const body = {
      mode: 'exercise' as const,
      plan: DEFAULT_PLAN,
      settings: DEFAULT_EXERCISE_SETTINGS,
    };
    const open = await api.createSession({ ...body, calibration_id: 1 });
    const close = await api.createSession({ ...body, calibration_id: 2 });
    expect(open.assist_direction).toBe('open');
    expect(close.assist_direction).toBe('close');
    const rom = await api.getHistoryRom({});
    const assistance = await api.getHistoryAssist();
    const overview = await api.getHistoryOverview();
    for (const point of overview.per_finger) {
      const cohort = rom.filter(
        (p) => p.finger === point.finger && p.assist_direction === 'open',
      );
      expect(point.active_max_first).toBe(cohort[0].active_max_mean);
      expect(point.active_max_last).toBe(cohort.at(-1)!.active_max_mean);
    }
    expect(new Set(rom.map((p) => p.assist_direction))).toEqual(
      new Set(['open', 'close']),
    );
    expect(new Set(assistance.map((p) => p.assist_direction))).toEqual(
      new Set(['open', 'close']),
    );
    expect(
      (await api.getHistoryResistance()).every(
        (p) => p.assist_direction === 'open',
      ),
    ).toBe(true);
  });
  it('persists sessions, attempts, traces, transcript and summaries, then cascades deletion', async () => {
    const session = await api.createSession({
      mode: 'exercise',
      plan: DEFAULT_PLAN,
      settings: DEFAULT_EXERCISE_SETTINGS,
      calibration_id: 1,
    });
    const {
      id: _id,
      session_id: _session,
      ...metrics
    } = fixtures.session_detail.attempts[0];
    const result = { ...metrics, trace: fixtures.attempt_trace };
    const attempt = await api.addAttempt({ id: session.id, result });
    expect(await api.getAttemptTrace(attempt.id)).toEqual(
      fixtures.attempt_trace,
    );
    expect((await api.getSession(session.id)).n_attempts).toBe(1);
    await api.addTranscript({
      id: session.id,
      lines: fixtures.session_detail.transcript,
    });
    expect((await api.getSession(session.id)).transcript).toEqual(
      fixtures.session_detail.transcript,
    );
    await api.endSession({
      id: session.id,
      summary: fixtures.sessions[0].summary!,
    });
    expect((await api.getSession(session.id)).ended_at).not.toBeNull();
    expect(await api.getSessions({ limit: 1 })).toHaveLength(1);
    expect((await api.getSessions({ offset: 1 }))[0].id).toBe(14);
    expect(await api.getSessions({ limit: 0 })).toHaveLength(0);
    await expect(
      api.createSummary({ kind: 'session', session_id: session.id }),
    ).rejects.toMatchObject({ status: 503 });
    await api.deleteSession(session.id);
    await expect(api.getSession(session.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(api.getAttemptTrace(attempt.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(
      (await api.getSummaries()).some((s) => s.session_id === session.id),
    ).toBe(false);
  });
  it('covers evaluations, all history endpoints, therapist summaries, exports and unavailable voice', async () => {
    const { id: _id, ...value } = fixtures.evaluations[0];
    const e = await api.createEvaluation(value);
    expect(await api.getEvaluation(e.id)).toEqual(e);
    expect(await api.getEvaluations()).toHaveLength(5);
    expect((await api.getHistoryOverview()).evaluations).toBe(5);
    expect(
      await api.getHistoryRom({ finger: 'index', pose: 'full_fist' }),
    ).toHaveLength(14);
    expect(await api.getHistoryAssist()).toHaveLength(70);
    expect(await api.getHistoryResistance()).toHaveLength(25);
    await expect(
      api.createSummary({ kind: 'therapist', days: 7 }),
    ).rejects.toMatchObject({ status: 503 });
    expect((await api.exportData('json')).type).toContain('application/json');
    expect((await api.exportData('csv')).type).toContain('text/csv');
    await expect(api.createVoiceToken(null)).rejects.toMatchObject({
      status: 503,
      detail: { code: 'voice_unavailable' },
    });
  });
});

describe('scripted runtime', () => {
  it('plays every default-plan attempt with events, assist, one resistance event and summary', async () => {
    vi.useFakeTimers();
    const runtime: Runtime = new ScriptedRuntime({ persist: false });
    const script = runtime as ScriptedRuntime,
      events: EngineEvent[] = [];
    const unsubscribe = runtime.exercise.onEvent((e) => events.push(e));
    await runtime.exercise.start(DEFAULT_PLAN, DEFAULT_EXERCISE_SETTINGS);
    vi.advanceTimersByTime(450_000);
    expect(runtime.exercise.view().phase).toBe('DONE');
    expect(runtime.exercise.view().summary!.attempts).toBe(8);
    expect(events.filter((e) => e.kind === 'resistance')).toHaveLength(1);
    expect(events.some((e) => e.kind === 'assist_started')).toBe(true);
    expect(events.some((e) => e.kind === 'progress')).toBe(true);
    const attempts = events
      .filter((e) => e.kind === 'attempt_done')
      .map((e) => e.result);
    expect(attempts).toHaveLength(8);
    expect(attempts.every((r) => r.trace.hz === 20)).toBe(true);
    for (const result of attempts) {
      expect(
        result.fingers
          .filter((f) => f.finger === 'ring' || f.finger === 'pinky')
          .every((f) => f.scored),
      ).toBe(true);
      expect(result.trace.t.length).toBe(result.trace.phase.length);
    }
    expect(vi.getTimerCount()).toBe(0);
    unsubscribe();
    script.dispose();
  });
  it('pauses, resumes into release, skips and stops without leaking timers', async () => {
    vi.useFakeTimers();
    const runtime = new ScriptedRuntime({ persist: false });
    await runtime.exercise.start(DEFAULT_PLAN, DEFAULT_EXERCISE_SETTINGS);
    vi.advanceTimersByTime(4000);
    runtime.exercise.pause();
    const snapshot = runtime.exercise.view();
    vi.advanceTimersByTime(5000);
    expect(runtime.exercise.view()).toEqual(snapshot);
    runtime.exercise.resume();
    expect(runtime.exercise.view().phase).toBe('RELEASE');
    vi.advanceTimersByTime(4000);
    expect(runtime.exercise.view().index).toBe(1);
    runtime.exercise.skip();
    vi.advanceTimersByTime(4000);
    expect(runtime.exercise.view().index).toBe(2);
    await runtime.exercise.stop();
    expect(runtime.exercise.view().phase).toBe('DONE');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('persists the scripted session through the mock API', async () => {
    const runtime = new ScriptedRuntime();
    await runtime.exercise.start([{ pose: 'full_fist', reps: 1 }], {
      ...DEFAULT_EXERCISE_SETTINGS,
      present_s: 0.1,
      attempt_s: 0.1,
      hold_s: 0.1,
      assist_max_s: 0.1,
      rest_s: 0.1,
    });
    runtime.dispose();
    for (let i = 0; i < 50; i++) runtime.advance(0.05);
    await runtime.exercise.stop();
    const session = await api.getSession(runtime.exercise.view().sessionId!);
    expect(session.attempts).toHaveLength(1);
    expect(session.summary!.attempts).toBe(1);
    expect(session.is_demo).toBe(true);
  });
  it('plays ten evaluation sweeps and can abort and run fake friction calibration', async () => {
    vi.useFakeTimers();
    const runtime = new ScriptedRuntime({ persist: false });
    await runtime.evaluation.start(DEFAULT_EVAL_SETTINGS);
    vi.advanceTimersByTime(50_000);
    expect(runtime.evaluation.view().stage).toBe('done');
    expect(runtime.evaluation.view().result!.sweeps).toHaveLength(10);
    expect(runtime.evaluation.view().result!.fingers).toHaveLength(5);
    expect(vi.getTimerCount()).toBe(0);
    await runtime.evaluation.start(DEFAULT_EVAL_SETTINGS);
    await runtime.evaluation.stop();
    expect(runtime.evaluation.view().stage).toBe('aborted');
    expect(vi.getTimerCount()).toBe(0);
    expect(
      Object.keys(await runtime.evaluation.runFriction(['index'])),
    ).toEqual(['index']);
  });
  it('publishes synthetic telemetry and sine vision, and cleans up providers sources', async () => {
    vi.useFakeTimers();
    const glove = new StubGlove(),
      vision = new StubVision();
    const tel = vi.fn(),
      frames = vi.fn();
    const a = glove.onTelemetry(tel),
      b = vision.onFrame(frames);
    expect((await glove.connect()).fw).toBe('WP0-stub');
    await vision.start({ affectedHand: 'left' });
    vi.advanceTimersByTime(1000);
    expect(tel).toHaveBeenCalledTimes(50);
    expect(frames.mock.calls.length).toBeGreaterThanOrEqual(30);
    expect(vision.latest()!.handedness).toBe('left');
    expect(vision.latest()!.closure!.index).toBeGreaterThan(0);
    a();
    b();
    await glove.disconnect();
    vision.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

// Relative luminance, WCAG 2.x. Keep exact spec tokens and identify limits separately.
function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const rgb = hex
      .slice(1)
      .match(/../g)!
      .map((v) => parseInt(v, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const x = lum(a),
    y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
it('keeps body, secondary text, buttons and focus contrast accessible in both themes', () => {
  for (const theme of [tokens.light, tokens.dark]) {
    for (const surface of [theme.bg, theme.surface, theme.surface2]) {
      expect(contrast(theme.text, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.muted, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.accent, surface)).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(theme.accent, theme.bg)).toBeGreaterThanOrEqual(4.5);
  }
});
