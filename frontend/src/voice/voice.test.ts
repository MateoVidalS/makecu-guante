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
import { fallbackPhrase } from './fallbackCoach';
import { TranscriptBatcher } from './transcript';
import { dispatchTool } from './tools';
import { decodePCM, encodePCM } from './audio';

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
  ['overcurrent', 'Stopping. I felt resistance in your index.'],
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
    'Stopping. I felt resistance in your middle.',
    expect.any(Function),
  );
  expect(s.deps.token).not.toHaveBeenCalled();
  s.controller.dispose();
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
        text: 'Stopping. I felt resistance in your index.',
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
    POSES.hook.instruction,
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
        from: [0, 0.4, 0],
        to: [0, 0.6, 0],
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
    expect(events.map(fallbackPhrase)).toEqual([
      POSES.hook.instruction,
      null,
      null,
      'Great, hold it.',
      'Good effort. The glove will help now.',
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
  ).toEqual({ instruction: s.runtime.exercise.view().pose.instruction });
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
    'Stopping. I felt resistance in your index.',
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
