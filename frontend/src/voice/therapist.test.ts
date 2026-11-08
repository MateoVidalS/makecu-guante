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
  applied: { speed: 0.2 },
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
    highlighted_finger: 'index',
    glove: { state: 'run', current_ma: 240, simulated: true },
    last_safety: { source: 'resistance', finger: 'index', seconds_ago: 5 },
    adjustments: {
      assist_speed: {
        thumb: 0.2,
        index: 0.2,
        middle: 0.2,
        ring: 0.2,
        pinky: 0.2,
      },
      assist_delay_s: { thumb: 6, index: 6, middle: 6, ring: 6, pinky: 6 },
      target_scale: { thumb: 1, index: 1, middle: 1, ring: 1, pinky: 1 },
      extra_reps: 0,
      hold_extra_s: 0,
      intensified: [],
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
    notePatientSpeech: vi.fn(),
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
/** [live] state lines inside the messages sent to the coach (they ride along, merged). */
function liveLines(texts: { text: string; speak: boolean }[]) {
  return texts.flatMap((t) =>
    t.text
      .split('\n')
      .filter((line) => line.startsWith('[live]'))
      .map((line) => ({
        text: line,
        speak: t.speak,
        state: JSON.parse(line.slice(7)),
      })),
  );
}
const attemptStarted = {
  kind: 'phase',
  phase: 'ATTEMPT',
  pose: 'full_fist',
  rep: 1,
  index: 0,
} as const;

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
it('sends live state only with another message (no per-second stream), only in active phases, with nullable measurements', async () => {
  const s = setup();
  await s.controller.start(1);
  const before = s.transport.texts.length;
  // Time alone sends nothing: a message every second cut off the coach's answers.
  await vi.advanceTimersByTimeAsync(5000);
  expect(liveLines(s.transport.texts.slice(before))).toHaveLength(0);
  s.emit(attemptStarted);
  await vi.advanceTimersByTimeAsync(10);
  const [line] = liveLines(s.transport.texts);
  expect(line.speak).toBe(false);
  expect(line.state.fingers[0].now).toBeNull();
  expect(line.state.fingers[1]).toMatchObject({
    now: 45,
    target: 80,
    best_alone: 50,
    lagging: true,
  });
  s.state.phase = 'PAUSED';
  s.emit({ ...attemptStarted, index: 1 });
  await vi.advanceTimersByTimeAsync(10);
  expect(liveLines(s.transport.texts)).toHaveLength(1);
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

it.each([
  [
    'adjust_help',
    { finger: 'index', direction: 'more', reason: 'Start help sooner.' },
  ],
  [
    'adjust_help',
    { finger: 'index', direction: 'less', reason: 'Wait longer.' },
  ],
  [
    'adjust_help',
    { finger: 'index', direction: 'gentler', reason: 'Slow down.' },
  ],
  ['assist_finger_now', { finger: 'ring', reason: 'Help this finger now.' }],
  [
    'adjust_target',
    { finger: 'pinky', direction: 'lower', reason: 'Try a smaller target.' },
  ],
  [
    'adjust_target',
    {
      finger: 'pinky',
      direction: 'raise',
      reason: 'Return toward the pose target.',
    },
  ],
  ['highlight_finger', { finger: 'thumb' }],
  [
    'note_for_therapist',
    { text: 'Patient reports tingling in the little finger.' },
  ],
  ['repeat_pose', { reason: 'Patient asked for another repetition.' }],
] as const)(
  'dispatches approved %s requests unchanged through TherapyApi',
  async (name, args) => {
    const s = setup();
    await s.controller.start(1);
    const call = { id: 'approved', name, args };
    s.transport.emit({ type: 'tools', calls: [call] });
    await Promise.resolve();
    expect(s.therapy.adjust).toHaveBeenCalledExactlyOnceWith(
      name,
      args,
      'coach',
    );
    expect(s.transport.responses).toEqual([
      { call, response: { ok: true, reason: decision.reason, decision } },
    ]);
    s.controller.dispose();
  },
);

it('sends approved timing, shaping, highlight, glove and safety fields with the next message', async () => {
  const s = setup();
  await s.controller.start(1);
  s.emit(attemptStarted);
  await vi.advanceTimersByTimeAsync(10);
  const [line] = liveLines(s.transport.texts);
  expect(line.speak).toBe(false);
  expect(line.state).toMatchObject({
    highlighted_finger: 'index',
    glove: { state: 'run', current_ma: 240, simulated: true },
    last_safety: { source: 'resistance', finger: 'index', seconds_ago: 5 },
    adjustments: {
      assist_speed: { index: 0.2 },
      assist_delay_s: { index: 6 },
      target_scale: { index: 1 },
      extra_reps: 0,
    },
  });
  s.controller.dispose();
});

it('permits a highlight and therapist note after a local brake while rejecting motion tools', async () => {
  const s = setup();
  await s.controller.start(1);
  s.transcript('it hurts', true);
  s.transport.emit({
    type: 'tools',
    calls: [
      { id: 'highlight', name: 'highlight_finger', args: { finger: 'pinky' } },
      {
        id: 'note',
        name: 'note_for_therapist',
        args: { text: 'Reports pain.' },
      },
      {
        id: 'assist',
        name: 'assist_finger_now',
        args: { finger: 'pinky', reason: 'Help now' },
      },
      {
        id: 'target',
        name: 'adjust_target',
        args: { finger: 'pinky', direction: 'raise', reason: 'Raise' },
      },
      {
        id: 'intensity',
        name: 'intensify',
        args: {
          finger: 'pinky',
          kind: 'faster',
          consent: 'patient_asked',
          patient_quote: 'Faster',
        },
      },
    ],
  });
  await Promise.resolve();
  expect(s.therapy.adjust).toHaveBeenCalledTimes(2);
  expect(s.therapy.adjust).toHaveBeenCalledWith(
    'note_for_therapist',
    { text: 'Reports pain.' },
    'coach',
  );
  expect(
    s.transport.responses.find((r) => r.call.id === 'assist')?.response.ok,
  ).toBe(false);
  expect(
    s.transport.responses.find((r) => r.call.id === 'target')?.response.ok,
  ).toBe(false);
  expect(
    s.transport.responses.find((r) => r.call.id === 'intensity')?.response.ok,
  ).toBe(false);
  s.controller.dispose();
});

it('reports only real patient transcriptions, before tools, without refreshing speech on context or flush', async () => {
  const s = setup();
  await s.controller.start(1);
  s.transcript('Yes, ');
  s.transcript('hold longer.', true);
  s.transport.emit({
    type: 'transcript',
    role: 'coach',
    text: 'You said yes.',
    finished: true,
  });
  s.transport.emit({ type: 'turnComplete' });
  await vi.advanceTimersByTimeAsync(21000);
  expect(vi.mocked(s.therapy.notePatientSpeech).mock.calls).toEqual([
    ['Yes, '],
    ['Yes, hold longer.'],
  ]);
  s.controller.stop();
  expect(s.therapy.notePatientSpeech).toHaveBeenCalledTimes(2);
  s.controller.dispose();
});

it.each([
  ['further', 'patient_asked', 'Can my index open further?'],
  ['hold_longer', 'accepted_offer', 'Yes, hold it longer.'],
  ['faster', 'patient_asked', 'Please help my index a little faster.'],
] as const)(
  'forwards %s intensity with actual patient speech and the quoted consent',
  async (kind, consent, patient_quote) => {
    const s = setup();
    await s.controller.start(1);
    s.transcript(patient_quote, true);
    const call = {
      id: 'intensity',
      name: 'intensify',
      args: { finger: 'index', kind, consent, patient_quote },
    };
    s.transport.emit({ type: 'tools', calls: [call] });
    await Promise.resolve();
    expect(s.therapy.notePatientSpeech).toHaveBeenCalledExactlyOnceWith(
      patient_quote,
    );
    expect(s.therapy.adjust).toHaveBeenCalledExactlyOnceWith(
      'intensify',
      call.args,
      'coach',
    );
    expect(
      vi.mocked(s.therapy.notePatientSpeech).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(s.therapy.adjust).mock.invocationCallOrder[0]);
    expect(s.transport.responses[0].response.ok).toBe(true);
    s.controller.dispose();
  },
);

it('reports streamed patient text before a tool even when Live omits the finished flag', async () => {
  const s = setup();
  await s.controller.start(1);
  s.transcript('Yes');
  const args = {
    finger: 'index',
    kind: 'faster',
    consent: 'accepted_offer',
    patient_quote: 'Yes',
  };
  s.transport.emit({
    type: 'tools',
    calls: [{ id: 'streamed', name: 'intensify', args }],
  });
  await Promise.resolve();
  expect(s.therapy.notePatientSpeech).toHaveBeenCalledExactlyOnceWith('Yes');
  expect(s.therapy.adjust).toHaveBeenCalledExactlyOnceWith(
    'intensify',
    args,
    'coach',
  );
  s.controller.dispose();
});

it('never turns model-provided patient_quote into fresh patient speech and preserves runtime rejections', async () => {
  const s = setup();
  await s.controller.start(1);
  const rejection = {
    ...decision,
    tool: 'intensify',
    result: 'rejected' as const,
    applied: null,
    reason: 'Fresh patient consent required.',
  };
  vi.mocked(s.therapy.adjust).mockReturnValue(rejection);
  const args = {
    finger: 'index',
    kind: 'faster',
    consent: 'accepted_offer',
    patient_quote: 'Invented yes',
  };
  s.transport.emit({
    type: 'tools',
    calls: [{ id: 'invented', name: 'intensify', args }],
  });
  await Promise.resolve();
  expect(s.therapy.notePatientSpeech).not.toHaveBeenCalled();
  expect(s.transport.responses[0].response).toEqual({
    ok: false,
    reason: rejection.reason,
    decision: rejection,
  });
  s.controller.dispose();
});

it('reports simple-voice patient lines too, and keeps braking ahead of speech bookkeeping', async () => {
  const s = setup();
  s.controller.setMode('simple');
  await s.controller.start(1);
  s.patient('Yes');
  s.patient('Yes, but it hurts.', true);
  expect(vi.mocked(s.therapy.notePatientSpeech).mock.calls).toEqual([
    ['Yes'],
    ['Yes, but it hurts.'],
  ]);
  expect(vi.mocked(s.therapy.brake).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(s.therapy.notePatientSpeech).mock.invocationCallOrder[1],
  );
  s.controller.setMuted(true);
  s.patient('yes', true);
  s.controller.stop();
  s.patient('yes', true);
  expect(s.therapy.notePatientSpeech).toHaveBeenCalledTimes(2);
  s.controller.dispose();
});

it('sends intensity and hold overrides and their runtime auto-revert', async () => {
  const s = setup();
  await s.controller.start(1);
  s.state.adjustments.intensified = ['index'];
  s.state.adjustments.hold_extra_s = 2;
  s.state.adjustments.assist_speed.index = 0.3;
  s.emit(attemptStarted);
  await vi.advanceTimersByTimeAsync(10);
  s.state.adjustments.intensified = [];
  s.state.adjustments.hold_extra_s = 0;
  s.state.adjustments.assist_speed.index = 0.2;
  s.emit({ ...attemptStarted, index: 1 });
  await vi.advanceTimersByTimeAsync(10);
  const states = liveLines(s.transport.texts).map((l) => l.state);
  expect(states[0].adjustments).toMatchObject({
    intensified: ['index'],
    hold_extra_s: 2,
    assist_speed: { index: 0.3 },
  });
  expect(states[1].adjustments).toMatchObject({
    intensified: [],
    hold_extra_s: 0,
    assist_speed: { index: 0.2 },
  });
  s.controller.dispose();
});

it('fails closed for intensity while the runtime has no patient-speech tracker', async () => {
  const s = setup();
  Reflect.deleteProperty(s.therapy, 'notePatientSpeech');
  expect(
    await dispatchTool(
      s.runtime,
      {
        id: 'missing-tracker',
        name: 'intensify',
        args: {
          finger: 'index',
          kind: 'faster',
          consent: 'patient_asked',
          patient_quote: 'Please go faster.',
        },
      },
      null,
    ),
  ).toEqual({ ok: false, reason: 'Patient consent tracking unavailable.' });
  expect(s.therapy.adjust).not.toHaveBeenCalled();
  s.controller.dispose();
});
