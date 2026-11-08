import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { ScriptedRuntime } from '../runtime/ScriptedRuntime';
import { ApiRequestError } from '../api/client';
import { POSES } from '../contracts/poses';
import type { EngineEvent } from '../contracts/engine';
import type { VoiceToken } from '../contracts/api';
import { VoiceController, type VoiceDependencies } from './VoiceController';
import { FakeTransport } from './transport';
import { SafetyNet, safetyPhrase, BrowserLocalVoice } from './safetyNet';
import { CueScheduler, eventCue } from './cues';
import { fallbackPhrase, poseInstruction } from './fallbackCoach';
import { TranscriptBatcher } from './transcript';
import { dispatchTool } from './tools';
import { decodePCM, encodePCM } from './audio';
import { fingerName } from './fingerNames';

const token: VoiceToken = {
  token: 'auth_tokens/test',
  expires_at: '',
  model: 'test',
  voice: 'Puck',
  system_instruction: '',
  tools: [],
};
function setup() {
  const runtime = new ScriptedRuntime({ persist: false });
  let emit: (event: EngineEvent) => void = () => {};
  const unsubscribe = vi.fn();
  vi.spyOn(runtime.exercise, 'onEvent').mockImplementation((cb) => {
    emit = cb;
    return unsubscribe;
  });
  const transports: FakeTransport[] = [];
  const deps: VoiceDependencies = {
    token: vi.fn().mockResolvedValue(token),
    sessions: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(undefined),
    transport: () => {
      const t = new FakeTransport();
      transports.push(t);
      return t;
    },
    audio: {
      open: vi.fn().mockResolvedValue(undefined),
      play: vi.fn(),
      flush: vi.fn(),
      setMuted: vi.fn(),
      close: vi.fn(),
    },
    local: {
      unlock: vi.fn(),
      tone: vi.fn(),
      speak: vi.fn(),
      cancel: vi.fn(),
      dispose: vi.fn(),
    },
  };
  const controller = new VoiceController(runtime, deps);
  return {
    controller,
    deps,
    runtime,
    transports,
    emit: (event: EngineEvent) => emit(event),
    unsubscribe,
  };
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it.each([
  ['overcurrent', "I feel resistance opening your index, let's stop here."],
  ['stop_button', 'Stopped. Release the STOP button, then press Resume.'],
  ['watchdog', 'The glove disconnected. It has released.'],
  ['glove_disconnected', 'The glove disconnected. It has released.'],
  ['camera_lost', "I can't see your hand. Pausing."],
] as const)(
  'announces %s synchronously, even with voice off',
  (source, phrase) => {
    const s = setup();
    s.controller.setMode('off');
    const start = performance.now();
    const marks: number[] = [];
    vi.mocked(s.deps.local.tone).mockImplementation(() => {
      marks.push(performance.now() - start);
    });
    vi.mocked(s.deps.local.speak).mockImplementation(() => {
      marks.push(performance.now() - start);
    });
    s.emit({ kind: 'safety', source, finger: 'index', ma: null });
    expect(marks).toEqual([0, 0]);
    expect(marks[0]).toBeLessThan(50);
    expect(marks[1]).toBeLessThan(300);
    expect(s.deps.local.speak).toHaveBeenCalledWith(
      phrase,
      expect.any(Function),
    );
    expect(s.deps.audio.flush).toHaveBeenCalled();
    expect(s.controller.state.lastCoachLine).toBe(phrase);
    s.controller.dispose();
  },
);
it('announces resistance without a network call', () => {
  const s = setup();
  s.emit({ kind: 'resistance', finger: 'middle', ma: 950 });
  expect(s.deps.local.speak).toHaveBeenCalledWith(
    "I feel resistance opening your middle, let's stop here.",
    expect.any(Function),
  );
  expect(s.deps.token).not.toHaveBeenCalled();
  s.controller.dispose();
});
it.each([
  ['thumb', 'thumb'],
  ['index', 'index'],
  ['middle', 'middle'],
  ['ring', 'ring'],
  ['pinky', 'little finger'],
] as const)(
  'names %s consistently in local and Live safety phrases',
  (finger, name) => {
    expect(fingerName(finger)).toBe(name);
    const s = setup();
    s.controller.setMode('off');
    const event = { kind: 'resistance', finger, ma: 950 } as const;
    const phrase = `I feel resistance opening your ${name}, let's stop here.`;
    s.emit(event);
    expect(s.deps.local.speak).toHaveBeenCalledWith(
      phrase,
      expect.any(Function),
    );
    expect(eventCue(event, s.runtime.exercise.view())).toEqual({
      text: `[safety] ${phrase} Already announced locally. The runtime paused; check if they are OK.`,
      speak: false,
    });
    expect(
      safetyPhrase({ kind: 'safety', source: 'overcurrent', finger, ma: 950 }),
    ).toBe(phrase);
    s.controller.dispose();
  },
);
it('does not guess a finger when overcurrent attribution is unavailable', () => {
  expect(
    safetyPhrase({
      kind: 'safety',
      source: 'overcurrent',
      finger: null,
      ma: 1500,
    }),
  ).toBe("I feel resistance opening your hand, let's stop here.");
});
it('gives greeting, cues, tool round trips, interruption and batched transcripts', async () => {
  const s = setup();
  await s.controller.start(8);
  const t = s.transports[0];
  expect(t.texts[0].text).toContain('Starting');
  s.emit({ kind: 'phase', phase: 'PRESENT', pose: 'hook', rep: 1, index: 0 });
  expect(t.texts.at(-1)?.text).toContain(POSES.hook.instruction);
  const pause = vi.spyOn(s.runtime.exercise, 'pause');
  t.emit({ type: 'tools', calls: [{ id: '1', name: 'pause_session' }] });
  await Promise.resolve();
  expect(pause).toHaveBeenCalledOnce();
  expect(t.responses[0].response).toEqual({ ok: true });
  t.emit({ type: 'tools', calls: [{ id: '1', name: 'pause_session' }] });
  expect(pause).toHaveBeenCalledOnce();
  t.emit({ type: 'tools', calls: [{ id: '2', name: 'get_progress' }] });
  await Promise.resolve();
  expect(t.responses[1].response).toHaveProperty('current');
  t.emit({ type: 'audio', data: 'AAAA' });
  expect(s.deps.audio.play).toHaveBeenCalledWith('AAAA');
  t.emit({ type: 'interrupt' });
  expect(s.deps.audio.flush).toHaveBeenCalled();
  t.emit({
    type: 'transcript',
    role: 'patient',
    text: 'How am ',
    finished: false,
  });
  t.emit({
    type: 'transcript',
    role: 'patient',
    text: 'I doing?',
    finished: true,
  });
  t.emit({ type: 'transcript', role: 'coach', text: 'Good effort.' });
  t.emit({ type: 'turnComplete' });
  await vi.advanceTimersByTimeAsync(10000);
  expect(s.deps.save).toHaveBeenCalledWith(
    8,
    expect.arrayContaining([
      expect.objectContaining({ role: 'patient', text: 'How am I doing?' }),
      expect.objectContaining({ role: 'coach', text: 'Good effort.' }),
    ]),
  );
  s.emit({ kind: 'safety', source: 'overcurrent', finger: 'index', ma: 950 });
  t.emit({ type: 'audio', data: 'AAAA' });
  expect(s.deps.audio.play).toHaveBeenCalledTimes(1);
  s.controller.stop();
  await Promise.resolve();
  expect(s.deps.save).toHaveBeenLastCalledWith(
    8,
    expect.arrayContaining([
      expect.objectContaining({
        role: 'system',
        text: "I feel resistance opening your index, let's stop here.",
      }),
    ]),
  );
  s.controller.dispose();
  expect(s.unsubscribe).toHaveBeenCalledOnce();
});
it('falls back immediately without a key and visibly reports Simple voice', async () => {
  const s = setup();
  vi.mocked(s.deps.token).mockRejectedValue(
    new ApiRequestError(503, { code: 'voice_unavailable', message: '' }),
  );
  await s.controller.start(null);
  expect(s.controller.state).toMatchObject({
    mode: 'simple',
    unavailable: true,
  });
  s.emit({ kind: 'phase', phase: 'PRESENT', pose: 'hook', index: 0, rep: 1 });
  expect(s.deps.local.speak).toHaveBeenLastCalledWith(
    poseInstruction('hook'),
    expect.any(Function),
  );
  s.controller.dispose();
});
it('uses 1/3/6 second backoff and a fresh token on all three failed reconnects', async () => {
  const s = setup();
  await s.controller.start(null);
  vi.mocked(s.deps.token).mockRejectedValue(new Error('offline'));
  s.transports[0].emit({ type: 'closed' });
  await vi.advanceTimersByTimeAsync(999);
  expect(s.deps.token).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(s.deps.token).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(3000);
  expect(s.deps.token).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(6000);
  expect(s.deps.token).toHaveBeenCalledTimes(4);
  expect(s.controller.state).toMatchObject({
    mode: 'simple',
    unavailable: true,
  });
  s.controller.dispose();
});
it('ignores stale connections after stop and mode changes', async () => {
  const s = setup();
  let resolve!: (token: VoiceToken) => void;
  vi.mocked(s.deps.token).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const start = s.controller.start(8);
  s.controller.stop();
  resolve(token);
  await start;
  expect(s.controller.state.status).toBe('off');
  expect(s.deps.audio.open).not.toHaveBeenCalled();
  s.controller.dispose();
});
it('closes microphone on fallback and sends stream end when muted', async () => {
  const s = setup();
  await s.controller.start(null);
  const end = vi.spyOn(s.transports[0], 'endAudio');
  s.controller.setMuted(true);
  expect(end).toHaveBeenCalledOnce();
  expect(s.deps.audio.setMuted).toHaveBeenLastCalledWith(true);
  s.controller.setMode('simple');
  expect(s.deps.audio.close).toHaveBeenCalled();
  expect(s.transports[0].closed).toBe(true);
  s.controller.dispose();
});

it('a blocked microphone keeps Gemini Live as the voice (no robotic fallback) and says so', async () => {
  const s = setup();
  vi.mocked(s.deps.audio.open).mockResolvedValue(false);
  await s.controller.start(null);
  expect(s.controller.state.mode).toBe('live');
  expect(s.controller.state.micBlocked).toBe(true);
  expect(s.transports[0].closed).toBe(false);
  expect(s.deps.local.speak).not.toHaveBeenCalled();
  s.controller.dispose();
});

describe('cue table and scheduler', () => {
  it('covers the cue and fallback tables', () => {
    const s = setup(),
      view = s.runtime.exercise.view();
    const result = JSON.parse(
      readFileSync('../contracts/fixtures/session_detail.json', 'utf8'),
    ).attempts[0];
    const summary = JSON.parse(
      readFileSync('../contracts/fixtures/sessions.json', 'utf8'),
    )[0].summary;
    const events: EngineEvent[] = [
      { kind: 'phase', phase: 'PRESENT', pose: 'hook', index: 1, rep: 2 },
      { kind: 'phase', phase: 'ATTEMPT', pose: 'hook', index: 1, rep: 2 },
      { kind: 'progress', finger: 'index', active_max: 0.45 },
      { kind: 'reached', t_rel: 2.1, assisted: false },
      {
        kind: 'assist_started',
        fingers: ['index'],
        from: [0, 0.4, 0, 0, 0],
        to: [0, 0.6, 0, 0, 0],
      },
      { kind: 'attempt_done', result },
      { kind: 'session_done', summary },
      { kind: 'safety', source: 'overcurrent', finger: 'index', ma: 950 },
    ];
    const cues = events.map((e) => eventCue(e, view, result));
    expect(cues.every(Boolean)).toBe(true);
    expect(cues[1]?.speak).toBe(false);
    expect(cues[2]?.text).toContain('45%');
    expect(cues[3]?.text).toContain('2.1 s');
    expect(cues[5]?.text).toContain('Previous rep');
    expect(cues[7]?.speak).toBe(false);
    expect(events.map((e) => fallbackPhrase(e))).toEqual([
      poseInstruction('hook'),
      null,
      null,
      'Great, hold it.',
      "Good effort. I'll help you open.",
      'Nice work.',
      'Session done. Well done today.',
      null,
    ]);
    s.controller.dispose();
  });
  it('limits spoken pushes, replaces pending cues, and defers during patient speech', async () => {
    const send = vi.fn();
    const scheduler = new CueScheduler(send);
    scheduler.push({ text: 'first', speak: true });
    scheduler.push({ text: 'older', speak: true });
    scheduler.push({ text: 'newer', speak: true });
    scheduler.setTalking(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(send).toHaveBeenCalledTimes(1);
    scheduler.setTalking(false);
    expect(send).toHaveBeenLastCalledWith({ text: 'newer', speak: true });
    scheduler.setTalking(true);
    scheduler.push({ text: 'PRESENT', speak: true, present: true });
    await vi.advanceTimersByTimeAsync(2500);
    expect(send).toHaveBeenLastCalledWith({
      text: 'PRESENT',
      speak: true,
      present: true,
    });
    scheduler.clear();
  });
  it('throttles progress gains to 10%, three seconds and one encouragement per attempt', async () => {
    const send = vi.fn();
    const scheduler = new CueScheduler(send);
    const push = (active_max: number) =>
      scheduler.push(
        { text: 'progress', speak: true },
        { kind: 'progress', finger: 'index', active_max },
      );
    push(0.05);
    expect(send).not.toHaveBeenCalled();
    push(0.1);
    expect(send).toHaveBeenCalledTimes(1);
    push(0.3);
    await vi.advanceTimersByTimeAsync(4000);
    push(0.4);
    expect(send).toHaveBeenCalledTimes(1);
    scheduler.clear();
  });
});
it('retries failed transcript batches in order', async () => {
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error())
    .mockResolvedValue(undefined);
  const batch = new TranscriptBatcher(save);
  batch.start();
  batch.add('patient', 'Pause');
  await vi.advanceTimersByTimeAsync(10000);
  batch.add('coach', 'Paused');
  await vi.advanceTimersByTimeAsync(10000);
  expect(save.mock.calls[1][0].map((l: { text: string }) => l.text)).toEqual([
    'Pause',
    'Paused',
  ]);
  await batch.stop();
});
it('dispatches only runtime tools, with safe errors', async () => {
  const s = setup();
  for (const [name, method] of [
    ['pause_session', 'pause'],
    ['resume_session', 'resume'],
    ['skip_pose', 'skip'],
    ['stop_session', 'stop'],
  ] as const) {
    const spy = vi.spyOn(s.runtime.exercise, method);
    await dispatchTool(s.runtime, { id: name, name }, null);
    expect(spy).toHaveBeenCalled();
  }
  expect(
    await dispatchTool(s.runtime, { id: '', name: 'repeat_instruction' }, null),
  ).toEqual({
    instruction: poseInstruction(s.runtime.exercise.view().pose.id),
  });
  expect(
    await dispatchTool(s.runtime, { id: '', name: 'target' }, null),
  ).toEqual({ error: 'Unknown tool' });
  s.controller.dispose();
});
it('encodes little-endian PCM losslessly', () => {
  const buffer = new Uint8Array([0, 128, 255, 127, 0, 0]).buffer;
  expect(new Uint8Array(decodePCM(encodePCM(buffer)))).toEqual(
    new Uint8Array(buffer),
  );
});
it.each([44100, 48000])(
  'captures 16 kHz PCM16 from %i Hz and flushes the player',
  (sampleRate) => {
    const processors = new Map<
      string,
      new () => {
        port: { onmessage: (e: { data: ArrayBuffer | string }) => void };
        process(inputs: Float32Array[][], outputs?: Float32Array[][]): boolean;
      }
    >();
    const messages: ArrayBuffer[] = [];
    const context = {
      sampleRate,
      AudioWorkletProcessor: class {
        port = {
          postMessage: (b: ArrayBuffer) => messages.push(b),
          onmessage: () => {},
        };
      },
      registerProcessor: (name: string, ctor: never) =>
        processors.set(name, ctor),
    };
    runInNewContext(
      readFileSync('src/voice/capture.worklet.js', 'utf8'),
      context,
    );
    const capture = new (processors.get('voice-capture')!)();
    const samples = new Float32Array(sampleRate / 10).fill(0.5);
    for (let i = 0; i < samples.length; i += 128)
      capture.process([[samples.subarray(i, i + 128)]]);
    expect(messages).toHaveLength(5);
    expect(new DataView(messages[0]).getInt16(0, true)).toBe(16384);
    runInNewContext(
      readFileSync('src/voice/player.worklet.js', 'utf8'),
      context,
    );
    const player = new (processors.get('voice-player')!)();
    const out = new Float32Array(128);
    player.port.onmessage({ data: new Uint8Array(3840).fill(63).buffer });
    player.process([], [[out]]);
    expect(out[0]).toBeGreaterThan(0);
    player.port.onmessage({ data: 'flush' });
    player.process([], [[out]]);
    expect(out.every((v) => v === 0)).toBe(true);
    player.port.onmessage({ data: new Uint8Array(640).fill(63).buffer });
    for (let i = 0; i < Math.ceil((sampleRate * 0.04) / 128); i++)
      player.process([], [[out]]);
    expect(out.some((v) => v > 0)).toBe(true);
  },
);
it('plays every sample of a long reply that arrives faster than real time', () => {
  // Gemini Live streams a 10 s answer in bursts, far ahead of playback. The player must
  // queue all of it: dropping the oldest audio made long doctor-chat answers sound chopped.
  const processors = new Map<
    string,
    new () => {
      port: { onmessage: (e: { data: ArrayBuffer | string }) => void };
      process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
    }
  >();
  const sampleRate = 24000;
  runInNewContext(readFileSync('src/voice/player.worklet.js', 'utf8'), {
    sampleRate,
    AudioWorkletProcessor: class {
      port = { postMessage: () => {}, onmessage: () => {} };
    },
    registerProcessor: (name: string, ctor: never) =>
      processors.set(name, ctor),
  });
  const player = new (processors.get('voice-player')!)();
  const seconds = 10;
  for (let chunk = 0; chunk < seconds * 10; chunk++) {
    const pcm = new DataView(new ArrayBuffer(4800)); // 100 ms of 24 kHz PCM16
    for (let i = 0; i < 2400; i++) pcm.setInt16(i * 2, 8000, true);
    player.port.onmessage({ data: pcm.buffer });
  }
  let played = 0;
  const out = new Float32Array(128);
  for (let block = 0; block < (seconds + 1) * (sampleRate / 128); block++) {
    player.process([], [[out]]);
    played += out.filter((v) => v > 0).length;
  }
  expect(played).toBeGreaterThan(seconds * sampleRate * 0.99);
});
it('uses browser speech synthesis synchronously', () => {
  const speak = vi.fn();
  vi.stubGlobal('speechSynthesis', {
    speak,
    cancel: vi.fn(),
    getVoices: () => [],
  });
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      constructor(public text: string) {}
    },
  );
  const voice = new BrowserLocalVoice();
  const caption = vi.fn();
  const safety = new SafetyNet(voice, vi.fn(), caption);
  const event = {
    kind: 'safety',
    source: 'overcurrent',
    finger: null,
    ma: null,
  } as const;
  safety.handle(event);
  expect(speak).toHaveBeenCalledWith(
    expect.objectContaining({ text: safetyPhrase(event) }),
  );
  vi.unstubAllGlobals();
});

it('keeps the local safety announcement through the following PAUSED event', async () => {
  const s = setup();
  await s.controller.start(null);
  s.emit({ kind: 'safety', source: 'overcurrent', finger: 'index', ma: 950 });
  const cancellations = vi.mocked(s.deps.local.cancel).mock.calls.length;
  s.emit({ kind: 'phase', phase: 'PAUSED', pose: 'hook', index: 0, rep: 1 });
  s.transports[0].emit({
    type: 'transcript',
    role: 'coach',
    text: 'Stale encouragement',
  });
  expect(s.deps.local.cancel).toHaveBeenCalledTimes(cancellations);
  expect(s.controller.state.lastCoachLine).toBe(
    "I feel resistance opening your index, let's stop here.",
  );
  s.controller.dispose();
});
it('retries a failed end-of-session transcript after stop', async () => {
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error())
    .mockResolvedValue(undefined);
  const batch = new TranscriptBatcher(save);
  batch.start();
  batch.add('system', 'Stopped.');
  await batch.stop();
  await vi.advanceTimersByTimeAsync(10000);
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][0][0].text).toBe('Stopped.');
  batch.dispose();
});

it('times out stalled token requests and reaches fallback', async () => {
  const s = setup();
  vi.mocked(s.deps.token).mockImplementation(() => new Promise(() => {}));
  const start = s.controller.start(null);
  await vi.advanceTimersByTimeAsync(75000);
  await start;
  expect(s.deps.token).toHaveBeenCalledTimes(4);
  expect(s.controller.state.mode).toBe('simple');
  s.controller.dispose();
});
it('protects pending PRESENT instructions from progress pushes', async () => {
  const send = vi.fn();
  const scheduler = new CueScheduler(send);
  scheduler.push({ text: 'previous coach line', speak: true });
  scheduler.push({ text: 'instruction', speak: true, present: true });
  scheduler.push({ text: 'noncritical progress', speak: true });
  await vi.advanceTimersByTimeAsync(2500);
  expect(send).toHaveBeenLastCalledWith({
    text: 'instruction',
    speak: true,
    present: true,
  });
  scheduler.clear();
});

it('does not count successful periodic reconnects as failures', async () => {
  const s = setup();
  await s.controller.start(null);
  for (let i = 0; i < 4; i++) {
    s.transports.at(-1)!.emit({ type: 'closed' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.controller.state.mode).toBe('live');
    expect(s.transports.at(-1)!.texts[0].text).toContain('Reconnected');
  }
  expect(s.deps.token).toHaveBeenCalledTimes(5);
  s.controller.dispose();
});

it('sends compact five-finger context at start and reconnect', async () => {
  const s = setup();
  const view = {
    ...s.runtime.exercise.view(),
    pose: POSES.hook,
    activeMax: { thumb: 0.2, index: 0.6, middle: 0.6, ring: 0.4, pinky: 0.5 },
  };
  vi.spyOn(s.runtime.exercise, 'view').mockReturnValue(view);
  const session = JSON.parse(
    readFileSync('../contracts/fixtures/sessions.json', 'utf8'),
  )[0];
  session.id = 7;
  session.assist_direction = 'open';
  session.summary.per_finger = [
    { finger: 'index', active_max_mean: 0.6, assist_needed_mean: 0 },
    { finger: 'pinky', active_max_mean: 0.3, assist_needed_mean: 0.3 },
  ];
  vi.mocked(s.deps.sessions).mockResolvedValue([session]);
  await s.controller.start(8);
  s.transports[0].emit({ type: 'closed' });
  await vi.advanceTimersByTimeAsync(1000);
  for (const transport of s.transports) {
    const text = transport.texts[0].text;
    expect(text).toContain(
      'Active movement (closure/target): ring 40%/60%; little finger 50%/60%',
    );
    expect(text).toContain(
      'little finger active closure 30%, mean target shortfall 30%',
    );
    expect(text).not.toContain('index active');
    expect(text).not.toContain('"per_finger"');
    expect(text).not.toContain('pinky');
  }
  expect(s.transports).toHaveLength(2);
  s.controller.dispose();
});

it('schedules a distinct three-beep safety cue above the ordinary cue volume', () => {
  const starts: number[] = [];
  const volumes: number[] = [];
  vi.stubGlobal(
    'AudioContext',
    class {
      currentTime = 10;
      destination = {};
      resume = async () => {};
      close = async () => {};
      createGain() {
        return {
          gain: {
            setValueAtTime: (value: number) => volumes.push(value),
            exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
        };
      }
      createOscillator() {
        return {
          frequency: { value: 0 },
          connect: (gain: unknown) => gain,
          start: (at: number) => starts.push(at),
          stop: vi.fn(),
        };
      }
    },
  );
  try {
    const voice = new BrowserLocalVoice();
    voice.tone('safety');
    expect(starts).toEqual([10, 10.22, 10.44]);
    const safetyVolume = volumes[0];
    starts.length = 0;
    volumes.length = 0;
    voice.tone('cue');
    expect(starts).toEqual([10]);
    expect(volumes[0]).toBeLessThan(safetyVolume);
    voice.dispose();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('describes opening assistance and independent fist practice in every instruction path', async () => {
  const s = setup();
  const open = {
    kind: 'phase',
    phase: 'PRESENT',
    pose: 'open',
    rep: 1,
    index: 0,
  } as const;
  const fist = { ...open, pose: 'full_fist' } as const;
  expect(fallbackPhrase(open)).toBe('Open your hand as wide as you can.');
  expect(fallbackPhrase(fist)).toBe('Make a fist.');
  // The glove is explained once, on the first pose, not in every instruction.
  expect(eventCue(fist, s.runtime.exercise.view())?.text).toContain(
    'glove only helps fingers open',
  );
  expect(
    eventCue({ ...fist, index: 2 }, s.runtime.exercise.view())?.text,
  ).not.toContain('glove');
  expect(eventCue(fist, s.runtime.exercise.view())?.text).toContain(
    'in your own words',
  );
  const instruction = await dispatchTool(
    s.runtime,
    { id: 'repeat', name: 'repeat_instruction' },
    null,
  );
  expect(instruction).toEqual({
    instruction: poseInstruction(s.runtime.exercise.view().pose.id),
  });
  s.controller.dispose();
});

it('encourages decreasing closure during opening without relaxing speech limits', () => {
  const sent = vi.fn();
  const scheduler = new CueScheduler(sent);
  const s = setup();
  const view = { ...s.runtime.exercise.view(), pose: POSES.open };
  const progress = {
    kind: 'progress',
    finger: 'index',
    active_max: 0.6,
  } as const;
  const cue = eventCue(progress, view)!;
  expect(cue.text).toContain('closure now at 60%');
  scheduler.push(cue, progress);
  expect(sent).toHaveBeenLastCalledWith(
    expect.objectContaining({ speak: true }),
  );
  vi.advanceTimersByTime(4000);
  const next = { ...progress, active_max: 0.4 };
  scheduler.push(eventCue(next, view)!, next);
  // One encouragement per attempt, even though opening improved by 20%.
  expect(sent).toHaveBeenCalledTimes(1);
  scheduler.clear();
  s.controller.dispose();
});

it.each(['close', undefined] as const)(
  'excludes %s legacy summaries from opening greetings',
  async (direction) => {
    const s = setup();
    const old = JSON.parse(
      readFileSync('../contracts/fixtures/sessions.json', 'utf8'),
    )[0];
    old.assist_direction = direction;
    old.id = 1;
    vi.mocked(s.deps.sessions).mockResolvedValue([old]);
    await s.controller.start(2);
    s.transports[0].emit({ type: 'closed' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.transports.at(-1)!.texts[0].text).toContain(
      'Previous session: unavailable',
    );
    s.controller.dispose();
  },
);

it('ends a session smoothly: the goodbye finishes, whole sentences are saved, then the coach hangs up', async () => {
  const s = setup();
  await s.controller.start(8);
  const t = s.transports[0];
  const summary = JSON.parse(
    readFileSync('../contracts/fixtures/sessions.json', 'utf8'),
  )[0].summary;
  t.emit({ type: 'transcript', role: 'coach', text: 'That brings us ' });
  s.emit({ kind: 'session_done', summary });
  // Not cut mid-sentence, not hung up yet.
  expect(t.closed).toBe(false);
  expect(t.texts.at(-1)?.text).toContain('say goodbye');
  t.emit({ type: 'audio', data: 'AAAA' });
  t.emit({
    type: 'transcript',
    role: 'coach',
    text: 'to the end <no speech> of today.',
  });
  t.emit({ type: 'turnComplete' });
  await vi.advanceTimersByTimeAsync(2000);
  expect(t.closed).toBe(true);
  expect(s.controller.state.status).toBe('off');
  await vi.advanceTimersByTimeAsync(10000);
  expect(s.deps.save).toHaveBeenCalledWith(
    8,
    expect.arrayContaining([
      expect.objectContaining({
        role: 'coach',
        text: 'That brings us to the end of today.',
      }),
    ]),
  );
  s.controller.dispose();
});

it('hangs up after a session ends even if the coach never answers', async () => {
  const s = setup();
  await s.controller.start(8);
  const t = s.transports[0];
  const summary = JSON.parse(
    readFileSync('../contracts/fixtures/sessions.json', 'utf8'),
  )[0].summary;
  s.emit({ kind: 'session_done', summary });
  await vi.advanceTimersByTimeAsync(16000);
  expect(t.closed).toBe(true);
  s.controller.dispose();
});

it('on-screen Brake silences the coach until the patient speaks and tells the model', async () => {
  const s = setup();
  await s.controller.start(8);
  const t = s.transports[0];
  s.controller.brake('You pressed Brake.');
  expect(s.deps.audio.flush).toHaveBeenCalled();
  expect(s.deps.local.speak).toHaveBeenCalledWith(
    'Stopped. The glove has released. Tell me how you feel.',
    expect.any(Function),
  );
  expect(t.texts.at(-1)?.text).toContain('never resume');
  vi.mocked(s.deps.audio.play).mockClear();
  t.emit({ type: 'audio', data: 'AAAA' });
  expect(s.deps.audio.play).not.toHaveBeenCalled();
  // The local "Stopped" announcement finishes.
  vi.mocked(s.deps.local.speak).mock.calls.at(-1)?.[1]?.();
  await vi.advanceTimersByTimeAsync(600);
  t.emit({ type: 'audio', data: 'CCCC' });
  expect(s.deps.audio.play).not.toHaveBeenCalled();
  t.emit({ type: 'transcript', role: 'patient', text: 'I am fine' });
  t.emit({ type: 'audio', data: 'BBBB' });
  expect(s.deps.audio.play).toHaveBeenCalledWith('BBBB');
  s.controller.dispose();
});

it('varies Simple-voice phrases instead of repeating the same sentence', () => {
  const fist = {
    kind: 'phase',
    phase: 'PRESENT',
    pose: 'full_fist',
    rep: 1,
    index: 0,
  } as const;
  const said = [0, 1, 2].map((v) => fallbackPhrase(fist, v));
  expect(new Set(said).size).toBe(3);
  const done = [0, 1, 2].map((v) =>
    fallbackPhrase({ kind: 'reached', t_rel: 1, assisted: false }, v),
  );
  expect(new Set(done).size).toBe(3);
});

it('asks once to see the hand instead of repeating the pose every 8 s', async () => {
  const s = setup();
  await s.controller.start(8);
  const t = s.transports[0];
  const present = {
    kind: 'phase',
    phase: 'PRESENT',
    pose: 'full_fist',
    rep: 1,
    index: 1,
  } as const;
  s.emit(present);
  await vi.advanceTimersByTimeAsync(20000);
  const first = t.texts.filter((m) =>
    m.text.includes('[session] PRESENT:'),
  ).length;
  expect(first).toBe(1);
  // Re-prompts for the same attempt: one short "raise your hand", then silence.
  s.emit(present);
  await vi.advanceTimersByTimeAsync(20000);
  s.emit(present);
  await vi.advanceTimersByTimeAsync(20000);
  s.emit(present);
  await vi.advanceTimersByTimeAsync(20000);
  expect(
    t.texts.filter((m) => m.text.includes('[session] PRESENT:')),
  ).toHaveLength(1);
  expect(
    t.texts.filter((m) => m.text.includes("Still can't see the hand")),
  ).toHaveLength(1);
  // A new attempt gets its own invitation.
  s.emit({ ...present, index: 2 });
  await vi.advanceTimersByTimeAsync(20000);
  expect(
    t.texts.filter((m) => m.text.includes('[session] PRESENT:')),
  ).toHaveLength(2);
  s.controller.dispose();
});

it('gives one spoken turn per transition: the result rides with the next pose', async () => {
  const s = setup();
  await s.controller.start(8);
  const t = s.transports[0];
  const result = JSON.parse(
    readFileSync('../contracts/fixtures/session_detail.json', 'utf8'),
  ).attempts[0];
  const view = s.runtime.exercise.view();
  // The result alone is context, not a separate speech turn...
  const done = eventCue(
    { kind: 'attempt_done', result: { ...result, index: 0 } },
    view,
  );
  expect(done?.speak).toBe(false);
  // ...the next pose's cue carries it, so the coach reacts and invites in one turn.
  const next = eventCue(
    { kind: 'phase', phase: 'PRESENT', pose: 'open', rep: 1, index: 1 },
    view,
    { ...result, index: 0 },
  );
  expect(next?.speak).toBe(true);
  expect(next?.text).toContain('Previous attempt:');
  expect(next?.text).toContain('In ONE short turn');
  // A check-in after the third attempt is still spoken.
  s.emit({
    kind: 'attempt_done',
    result: { ...result, index: 2, interrupted: false },
  });
  await vi.advanceTimersByTimeAsync(20000);
  expect(t.texts.some((m) => m.text.includes('[check-in]'))).toBe(true);
  s.controller.dispose();
});

it('a forced fallback to the browser voice lasts one session; the next session tries Gemini Live again', async () => {
  const s = setup();
  vi.mocked(s.deps.token).mockRejectedValueOnce(
    new ApiRequestError(503, { code: 'voice_unavailable', message: '' }),
  );
  await s.controller.start(8);
  expect(s.controller.state.mode).toBe('simple');
  expect(s.controller.state.unavailable).toBe(true);
  await s.controller.start(9);
  expect(s.controller.state.mode).toBe('live');
  expect(s.deps.token).toHaveBeenCalledTimes(2);
  s.controller.dispose();
});

it('a Simple voice the user chose stays chosen', async () => {
  const s = setup();
  s.controller.setMode('simple');
  await s.controller.start(8);
  await s.controller.start(9);
  expect(s.controller.state.mode).toBe('simple');
  expect(s.deps.token).not.toHaveBeenCalled();
  s.controller.dispose();
});

describe('asking for help by voice', () => {
  const inAttempt = (s: ReturnType<typeof setup>, helpOffered: boolean) =>
    vi.spyOn(s.runtime.exercise, 'view').mockReturnValue({
      ...s.runtime.exercise.view(),
      phase: 'ATTEMPT',
      index: 0,
      helpOffered,
    });
  it('"ayudame" or "help" asks for the glove during an attempt, once', async () => {
    const s = setup();
    await s.controller.start(8);
    const t = s.transports[0];
    inAttempt(s, false);
    const ask = vi.spyOn(s.runtime.exercise, 'requestHelp');
    t.emit({ type: 'transcript', role: 'patient', text: 'Ayúdame por favor' });
    expect(ask).toHaveBeenCalledTimes(1);
    t.emit({
      type: 'transcript',
      role: 'patient',
      text: ' help',
      finished: true,
    });
    expect(ask).toHaveBeenCalledTimes(1);
    s.controller.dispose();
  });
  it('a plain "yes" counts only after help was offered', async () => {
    const s = setup();
    await s.controller.start(8);
    const t = s.transports[0];
    const view = inAttempt(s, false);
    const ask = vi.spyOn(s.runtime.exercise, 'requestHelp');
    t.emit({
      type: 'transcript',
      role: 'patient',
      text: 'yes',
      finished: true,
    });
    expect(ask).not.toHaveBeenCalled();
    view.mockReturnValue({
      ...s.runtime.exercise.view(),
      phase: 'ATTEMPT',
      index: 0,
      helpOffered: true,
    });
    t.emit({ type: 'transcript', role: 'patient', text: 'Sí', finished: true });
    expect(ask).toHaveBeenCalledTimes(1);
    s.controller.dispose();
  });
  it('the offer is one spoken question and the coach is told never to start help itself', () => {
    const s = setup();
    const cue = eventCue(
      { kind: 'help_offered', fingers: ['index', 'middle'] },
      s.runtime.exercise.view(),
    );
    expect(cue?.speak).toBe(true);
    expect(cue?.text).toContain('Never start help yourself');
    expect(
      fallbackPhrase({ kind: 'help_offered', fingers: ['index'] }),
    ).toContain('Help me open');
    s.controller.dispose();
  });
});
