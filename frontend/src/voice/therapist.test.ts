import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  CoachDecision,
  LiveTherapyState,
  TherapyApi,
} from '../contracts/therapist';
import { THERAPY_LIMITS } from '../contracts/therapist';
import { GLOVE_FINGERS } from '../contracts/glove';
import type { EngineEvent, AttemptResult } from '../contracts/engine';
import { ScriptedRuntime } from '../runtime/ScriptedRuntime';
import type { Runtime } from '../contracts/runtime';
import { VoiceController, type VoiceDependencies } from './VoiceController';
import { FakeTransport } from './transport';
import { patientBrakeReason } from './patientSafety';
import { dispatchTool } from './tools';

const decision: CoachDecision = {
  id: 'decision-1',
  t: '2026-11-07T00:00:00Z',
  session_id: 1,
  tool: 'adjust_help',
  requested: {},
  applied: { speed: 0.3 },
  result: 'clamped',
  reason: 'Safe speed cap.',
  source: 'coach',
};
function setup() {
  const runtime: Runtime = new ScriptedRuntime({ persist: false });
  let emit: (event: EngineEvent) => void = () => {};
  vi.spyOn(runtime.exercise, 'onEvent').mockImplementation((cb) => {
    emit = cb;
    return () => {};
  });
  const state: LiveTherapyState = {
    phase: 'ATTEMPT',
    pose: 'full_fist',
    rep: 1,
    index: 0,
    total: 9,
    seconds_in_phase: 2,
    fingers: GLOVE_FINGERS.map((finger) => ({
      finger,
      now: finger === 'thumb' ? null : 0.45,
      target: 0.8,
      best_alone: 0.5,
      glove_helping: false,
      lagging: finger === 'index',
    })),
    last_attempt: null,
    last_feeling: null,
    adjustments: {
      assist_speed: {
        thumb: 0.3,
        index: 0.3,
        middle: 0.3,
        ring: 0.3,
        pinky: 0.3,
      },
      attempt_s: 6,
      extra_rest_s: 0,
      next_pose: null,
    },
  };
  const therapy: TherapyApi = {
    limits: THERAPY_LIMITS,
    state: vi.fn(() => state),
    adjust: vi.fn(() => decision),
    brake: vi.fn(() => {
      state.phase = 'PAUSED';
      return { ...decision, tool: 'brake', result: 'applied' as const };
    }),
    recordFeeling: vi.fn(() => decision),
    undo: vi.fn(() => decision),
    decisions: () => [],
    feelings: () => [],
    onDecision: () => () => {},
  };
  runtime.therapy = therapy;
  const transport = new FakeTransport();
  let patient: (text: string, final: boolean) => void = () => {};
  const deps: VoiceDependencies = {
    token: vi.fn().mockResolvedValue({
      token: 'auth_tokens/fake',
      model: 'test',
      voice: 'Puck',
      tools: [],
      system_instruction: '',
      expires_at: '',
    }),
    sessions: async () => [],
    save: vi.fn().mockResolvedValue(undefined),
    transport: () => transport,
    audio: {
      open: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      flush: vi.fn(),
      play: vi.fn(),
      setMuted: vi.fn(),
    },
    local: {
      unlock: vi.fn(),
      tone: vi.fn(),
      speak: vi.fn(),
      cancel: vi.fn(),
      dispose: vi.fn(),
    },
    patient: {
      start: vi.fn((receive) => {
        patient = receive;
      }),
      stop: vi.fn(),
    },
  };
  const controller = new VoiceController(runtime, deps);
  const transcript = (text: string, finished = false) =>
    transport.emit({ type: 'transcript', role: 'patient', text, finished });
  const result = (index: number) =>
    ({
      index,
      interrupted: false,
      fingers: [],
      active_ratio: 0.5,
      reached_final: false,
      assisted: true,
    }) as unknown as AttemptResult;
  return {
    runtime,
    therapy,
    state,
    deps,
    transport,
    controller,
    transcript,
    patient: (text: string, final = false) => patient(text, final),
    emit: (event: EngineEvent) => emit(event),
    result,
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it.each([
  'Stop!',
  'please STOP now',
  'enough',
  'it hurts',
  'my index hurts',
  'para',
  'basta',
  'me duele',
  'dolor es cinco',
  'pain is four',
  'pain 4/10',
  'pain level is 10',
])(
  'brakes locally on interim "%s" without waiting for a tool',
  async (text) => {
    const s = setup();
    await s.controller.start(1);
    s.transcript(text);
    expect(s.therapy.brake).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      'local_rule',
    );
    expect(s.deps.local.tone).toHaveBeenCalledWith('safety');
    expect(s.deps.audio.flush).toHaveBeenCalled();
    s.transport.emit({ type: 'audio', data: 'stale' });
    expect(s.deps.audio.play).not.toHaveBeenCalled();
    s.controller.dispose();
  },
);
it.each([
  'unstoppable',
  'compare',
  'bastante',
  'pain is three',
  'fatigue 8',
  '5',
  'no pain',
])('does not treat "%s" as a brake request', (text) => {
  expect(patientBrakeReason(text)).toBeNull();
});
it('detects a phrase split across Live chunks once and blocks stale resume/adjust tools', async () => {
  const s = setup();
  await s.controller.start(1);
  const resume = vi.spyOn(s.runtime.exercise, 'resume');
  s.transcript('me ');
  s.transcript('duele');
  s.transcript(' mucho');
  expect(s.therapy.brake).toHaveBeenCalledTimes(1);
  s.transport.emit({
    type: 'tools',
    calls: [
      { id: 'resume', name: 'resume_session' },
      {
        id: 'adjust',
        name: 'adjust_help',
        args: { finger: 'all', direction: 'more' },
      },
    ],
  });
  expect(resume).not.toHaveBeenCalled();
  expect(s.therapy.adjust).not.toHaveBeenCalled();
  expect(s.transport.responses.every((r) => r.response.ok === false)).toBe(
    true,
  );
  s.transport.emit({ type: 'turnComplete' });
  s.transcript('continue', true);
  s.transport.emit({
    type: 'tools',
    calls: [{ id: 'resume-new', name: 'resume_session' }],
  });
  expect(resume).toHaveBeenCalledOnce();
  s.controller.dispose();
});
it('streams non-speaking live state every second only in active phases, with nullable measurements', async () => {
  const s = setup();
  await s.controller.start(1);
  const live = () =>
    s.transport.texts.filter((t) => t.text.startsWith('[live]'));
  await vi.advanceTimersByTimeAsync(999);
  expect(live()).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  const payload = JSON.parse(live()[0].text.slice(7));
  expect(live()[0].speak).toBe(false);
  expect(payload.fingers[0].now).toBeNull();
  expect(payload.fingers[1]).toMatchObject({
    now: 45,
    target: 80,
    best_alone: 50,
    lagging: true,
  });
  for (const phase of ['ASSIST', 'HOLD'] as const) {
    s.state.phase = phase;
    await vi.advanceTimersByTimeAsync(1000);
  }
  expect(live()).toHaveLength(3);
  s.state.phase = 'PAUSED';
  await vi.advanceTimersByTimeAsync(2000);
  expect(live()).toHaveLength(3);
  s.controller.stop();
  s.state.phase = 'ATTEMPT';
  await vi.advanceTimersByTimeAsync(2000);
  expect(live()).toHaveLength(3);
  s.controller.dispose();
});
it('checks in every three completed attempts, and a bare pain answer brakes locally', async () => {
  const s = setup();
  await s.controller.start(1);
  for (let index = 0; index < 3; index++) {
    s.emit({ kind: 'attempt_done', result: s.result(index) });
    await vi.advanceTimersByTimeAsync(3000);
  }
  expect(
    s.transport.texts.filter((t) => t.text.includes('[check-in]')),
  ).toHaveLength(1);
  s.transcript('five', true);
  expect(s.therapy.brake).toHaveBeenCalledWith(
    'Patient reported pain 5/10.',
    'local_rule',
  );
  s.controller.dispose();
});
it('keeps simple voice safety active without a token and saves final patient text', async () => {
  const s = setup();
  s.controller.setMode('simple');
  await s.controller.start(1);
  expect(s.deps.token).not.toHaveBeenCalled();
  expect(s.deps.patient?.start).toHaveBeenCalledOnce();
  s.patient('para', false);
  s.patient('para por favor', true);
  expect(s.therapy.brake).toHaveBeenCalledTimes(1);
  s.controller.setMuted(true);
  s.patient('stop', true);
  expect(s.therapy.brake).toHaveBeenCalledTimes(1);
  s.controller.setMuted(false);
  s.patient('pain five', true);
  expect(s.therapy.brake).toHaveBeenCalledTimes(2);
  s.controller.stop();
  await Promise.resolve();
  expect(s.deps.save).toHaveBeenCalledWith(
    1,
    expect.arrayContaining([
      expect.objectContaining({ role: 'patient', text: 'para por favor' }),
    ]),
  );
  s.controller.dispose();
});
it('routes all therapy tools through the contract and reports the runtime result', async () => {
  const s = setup();
  for (const name of [
    'adjust_help',
    'set_attempt_time',
    'add_rest',
    'choose_next_pose',
  ] as const) {
    const args = {
      seconds: 999,
      finger: 'unknown',
      reason: 'Patient is tired.',
    };
    expect(
      await dispatchTool(s.runtime, { id: name, name, args }, null),
    ).toEqual({ ok: true, reason: decision.reason, decision });
    expect(s.therapy.adjust).toHaveBeenLastCalledWith(name, args, 'coach');
  }
  expect(
    await dispatchTool(s.runtime, { id: 'read', name: 'get_live_state' }, null),
  ).toEqual({ ok: true, state: s.state });
  await dispatchTool(
    s.runtime,
    {
      id: 'feeling',
      name: 'record_feeling',
      args: { pain: 5, fatigue: 7, note: 'Sore' },
    },
    null,
  );
  expect(s.therapy.recordFeeling).toHaveBeenCalledWith({
    pain: 5,
    fatigue: 7,
    note: 'Sore',
    source: 'voice',
  });
  await dispatchTool(s.runtime, { id: 'brake', name: 'brake' }, null);
  expect(s.therapy.brake).toHaveBeenCalledWith(expect.any(String), 'coach');
  await dispatchTool(
    s.runtime,
    { id: 'undo', name: 'undo_last_adjustment' },
    null,
  );
  expect(s.therapy.undo).toHaveBeenCalledOnce();
  vi.mocked(s.therapy.adjust).mockReturnValue({
    ...decision,
    applied: null,
    result: 'rejected',
    reason: 'Too frequent.',
  });
  expect(
    await dispatchTool(s.runtime, { id: 'reject', name: 'adjust_help' }, null),
  ).toMatchObject({ ok: false, reason: 'Too frequent.' });
  // Malformed feelings are audited through the runtime validator, not silently coerced.
  await dispatchTool(
    s.runtime,
    { id: 'invalid', name: 'record_feeling', args: { pain: 'five' } },
    null,
  );
  expect(s.therapy.adjust).toHaveBeenLastCalledWith(
    'record_feeling',
    { pain: 'five' },
    'coach',
  );
  vi.mocked(s.therapy.undo).mockReturnValue(null);
  expect(
    await dispatchTool(
      s.runtime,
      { id: 'empty', name: 'undo_last_adjustment' },
      null,
    ),
  ).toMatchObject({ ok: false });
  s.controller.dispose();
});
it('returns unavailable safely before A1, with local stop still pausing the runtime', async () => {
  const s = setup();
  Reflect.deleteProperty(s.runtime, 'therapy');
  expect(
    await dispatchTool(s.runtime, { id: 'missing', name: 'adjust_help' }, null),
  ).toMatchObject({ ok: false });
  const pause = vi.spyOn(s.runtime.exercise, 'pause');
  await s.controller.start(1);
  s.transcript('stop');
  expect(pause).toHaveBeenCalledOnce();
  s.controller.dispose();
});
it('round-trips clamped and rejected tool decisions with FakeTransport exactly once', async () => {
  const s = setup();
  await s.controller.start(1);
  const call = {
    id: 'help',
    name: 'adjust_help',
    args: { finger: 'index', direction: 'more', reason: 'Tiring' },
  };
  s.transport.emit({ type: 'tools', calls: [call, call] });
  await Promise.resolve();
  expect(s.therapy.adjust).toHaveBeenCalledTimes(1);
  expect(s.transport.responses).toEqual([
    { call, response: { ok: true, reason: decision.reason, decision } },
  ]);
  s.controller.dispose();
});

it('does not unlock a local brake on negated or unfinished requests to continue', async () => {
  const s = setup();
  await s.controller.start(1);
  const resume = vi.spyOn(s.runtime.exercise, 'resume');
  s.transcript('stop', true);
  for (const [index, text] of [
    'do not continue',
    'I cannot continue',
    'please continue',
  ].entries()) {
    s.transcript(text, index !== 2);
    s.transport.emit({
      type: 'tools',
      calls: [{ id: `unsafe-${index}`, name: 'resume_session' }],
    });
  }
  expect(resume).not.toHaveBeenCalled();
  s.controller.dispose();
});

it('does not lose a pain check-in when a simple-voice interim rating is revised upward', async () => {
  const s = setup();
  s.controller.setMode('simple');
  await s.controller.start(1);
  s.emit({ kind: 'attempt_done', result: s.result(2) });
  s.patient('three');
  expect(s.therapy.brake).not.toHaveBeenCalled();
  s.patient('five', true);
  expect(s.therapy.brake).toHaveBeenCalledWith(
    'Patient reported pain 5/10.',
    'local_rule',
  );
  s.controller.dispose();
});

it('audits tool requests, runtime results and local rejections in the saved transcript', async () => {
  const s = setup();
  await s.controller.start(1);
  s.transport.emit({
    type: 'tools',
    calls: [
      {
        id: 'help',
        name: 'adjust_help',
        args: { direction: 'more', finger: 'index' },
      },
    ],
  });
  await Promise.resolve();
  s.transcript('stop', true);
  s.transport.emit({
    type: 'tools',
    calls: [{ id: 'stale', name: 'resume_session' }],
  });
  await vi.advanceTimersByTimeAsync(10000);
  const lines = vi.mocked(s.deps.save).mock.calls.flatMap((call) => call[1]);
  const audits = lines
    .filter((line) => line.role === 'system' && line.text.startsWith('[tool] '))
    .map((line) => JSON.parse(line.text.slice(7)));
  expect(audits).toEqual([
    {
      id: 'help',
      tool: 'adjust_help',
      requested: { direction: 'more', finger: 'index' },
      response: { ok: true, reason: decision.reason, decision },
    },
    {
      id: 'stale',
      tool: 'resume_session',
      requested: {},
      response: { ok: false, reason: expect.stringContaining('Patient brake') },
    },
  ]);
  s.controller.dispose();
});

it('saves a late stop tool result to its original session after voice has stopped', async () => {
  const s = setup();
  let finishStop!: () => void;
  vi.spyOn(s.runtime.exercise, 'stop').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishStop = resolve;
      }),
  );
  await s.controller.start(1);
  s.transport.emit({
    type: 'tools',
    calls: [{ id: 'stop-old', name: 'stop_session' }],
  });
  s.controller.stop();
  finishStop();
  await vi.advanceTimersByTimeAsync(0);
  expect(s.deps.save).toHaveBeenCalledWith(
    1,
    expect.arrayContaining([
      expect.objectContaining({
        role: 'system',
        text: expect.stringContaining('stop-old'),
      }),
    ]),
  );
  s.controller.dispose();
});
