import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScriptedRuntime } from '../runtime/ScriptedRuntime';
import type { EngineEvent } from '../contracts/engine';
import type { ExerciseView } from '../contracts/runtime';
import type { VoiceToken, TranscriptLine } from '../contracts/api';
import {
  VoiceController,
  helpPhrase,
  type VoiceDependencies,
} from './VoiceController';
import { FakeTransport } from './transport';
import { asksForHelp, patientBrakeReason } from './patientSafety';

/**
 * Voice timing (bench session 43): the coach announced help after the glove had released,
 * and gave a pose instruction 6 s into its attempt. The app now announces help itself, drops
 * spoken cues that are no longer true, tells the session when the voice is busy, and logs
 * how long each cue took to be heard.
 */
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
  vi.spyOn(runtime.exercise, 'onEvent').mockImplementation((cb) => {
    emit = cb;
    return () => {};
  });
  const base = runtime.exercise.view();
  let view: ExerciseView = { ...base, index: 0, phase: 'PRESENT', assisting: false };
  vi.spyOn(runtime.exercise, 'view').mockImplementation(() => view);
  const voiceBusy = vi.fn();
  runtime.exercise.voiceBusy = voiceBusy;
  const transports: FakeTransport[] = [];
  const audio = {
    open: vi.fn().mockResolvedValue(undefined),
    play: vi.fn(),
    flush: vi.fn(),
    setMuted: vi.fn(),
    close: vi.fn(),
    playing: false,
  };
  const speakDone: (() => void)[] = [];
  const deps: VoiceDependencies = {
    token: vi.fn().mockResolvedValue(token),
    sessions: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(undefined),
    transport: () => {
      const t = new FakeTransport();
      transports.push(t);
      return t;
    },
    audio,
    local: {
      unlock: vi.fn(),
      tone: vi.fn(),
      speak: vi.fn((_text: string, done?: () => void) => {
        if (done) speakDone.push(done);
      }),
      cancel: vi.fn(),
      dispose: vi.fn(),
    },
  };
  const controller = new VoiceController(runtime, deps);
  return {
    controller,
    runtime,
    deps,
    audio,
    voiceBusy,
    speakDone,
    transports,
    emit: (event: EngineEvent) => emit(event),
    setView: (patch: Partial<ExerciseView>) => {
      view = { ...view, ...patch };
    },
    saved: (): TranscriptLine[] =>
      vi.mocked(deps.save).mock.calls.flatMap((call) => call[1]),
  };
}
const transport = (s: ReturnType<typeof setup>) => s.transports.at(-1)!;
const coachTurn = (s: ReturnType<typeof setup>) => {
  transport(s).emit({ type: 'audio', data: 'AAAA' });
  transport(s).emit({ type: 'turnComplete' });
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the help announcement', () => {
  it('names one or two fingers, else the fingers or the hand', () => {
    expect(helpPhrase(['thumb'])).toBe('Opening your thumb now.');
    expect(helpPhrase(['index', 'middle'])).toBe(
      'Opening your index and middle now.',
    );
    expect(helpPhrase(['pinky'])).toBe('Opening your little finger now.');
    expect(helpPhrase(['thumb', 'index', 'middle'])).toBe(
      'Opening your fingers now.',
    );
    expect(helpPhrase(['thumb', 'index', 'middle', 'ring', 'pinky'])).toBe(
      'Opening your hand now.',
    );
  });

  it('can never be heard back as the patient asking for help or braking', () => {
    const all = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
    for (const fingers of [[...all], ['thumb'], ['ring', 'pinky']] as const) {
      const phrase = helpPhrase(fingers);
      expect(asksForHelp(phrase)).toBe(false);
      expect(patientBrakeReason(phrase)).toBeNull();
    }
  });

  it('is said by the app the moment help starts; the coach only gets it as context', async () => {
    const s = setup();
    await s.controller.start(1);
    s.setView({ phase: 'ASSIST', assisting: true });
    s.emit({
      kind: 'assist_started',
      fingers: ['thumb'],
      from: [0.6, 0, 0, 0, 0],
      to: [0.05, 0, 0, 0, 0],
    });
    expect(s.deps.local.speak).toHaveBeenCalledWith(
      'Opening your thumb now.',
      expect.any(Function),
    );
    expect(s.audio.flush).toHaveBeenCalled();
    // The coach learns it once the app's own sentence has been said.
    s.speakDone.forEach((done) => done());
    await vi.advanceTimersByTimeAsync(3000);
    const cue = transport(s).texts.find((t) =>
      t.text.includes('The glove is helping open now'),
    );
    expect(cue?.speak).toBe(false);
    expect(cue?.text).toContain('do not announce it again');
    s.controller.dispose();
  });

  it('holds the coach audio while it plays, then lets the coach speak again', async () => {
    const s = setup();
    await s.controller.start(1);
    s.setView({ phase: 'ASSIST', assisting: true });
    s.emit({
      kind: 'assist_started',
      fingers: ['index'],
      from: [0, 0.6, 0, 0, 0],
      to: [0, 0.05, 0, 0, 0],
    });
    transport(s).emit({ type: 'audio', data: 'AAAA' });
    expect(s.audio.play).not.toHaveBeenCalled();
    s.speakDone.forEach((done) => done());
    transport(s).emit({ type: 'audio', data: 'BBBB' });
    expect(s.audio.play).toHaveBeenCalledWith('BBBB');
    s.controller.dispose();
  });

  it('never stays muting the coach if speech never reports the end', async () => {
    const s = setup();
    await s.controller.start(1);
    s.setView({ phase: 'ASSIST', assisting: true });
    s.emit({
      kind: 'assist_started',
      fingers: ['ring'],
      from: [0, 0, 0, 0.6, 0],
      to: [0, 0, 0, 0.05, 0],
    });
    await vi.advanceTimersByTimeAsync(4100);
    transport(s).emit({ type: 'audio', data: 'CCCC' });
    expect(s.audio.play).toHaveBeenCalledWith('CCCC');
    s.controller.dispose();
  });
});

describe('spoken cues that are no longer true', () => {
  it('a "reached" cue still queued when its attempt ends is passed as context, not spoken', async () => {
    const s = setup();
    await s.controller.start(1);
    s.setView({ phase: 'ATTEMPT', index: 0 });
    // The coach is busy with a long sentence when the patient reaches the pose.
    transport(s).emit({ type: 'audio', data: 'AAAA' });
    s.emit({ kind: 'reached', t_rel: 2.4, assisted: false });
    // By the time the coach is done, the next attempt has started.
    s.setView({ phase: 'PRESENT', index: 1 });
    transport(s).emit({ type: 'turnComplete' });
    await vi.advanceTimersByTimeAsync(3000);
    const reached = transport(s).texts.filter((t) =>
      t.text.includes('Reached the position'),
    );
    expect(reached.length).toBeGreaterThan(0);
    expect(reached.every((t) => !t.speak)).toBe(true);
    expect(reached.at(-1)?.text).toContain('Already over');
    s.controller.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(
      s.saved().some(
        (l) =>
          l.text.startsWith('[timing]') && l.text.includes('"cue":"reached"'),
      ),
    ).toBe(true);
    s.controller.dispose();
  });

  it('a cue that is still true is spoken as before', async () => {
    const s = setup();
    await s.controller.start(1);
    s.setView({ phase: 'HOLD', index: 0 });
    s.emit({ kind: 'reached', t_rel: 2.4, assisted: false });
    await vi.advanceTimersByTimeAsync(3000);
    const reached = transport(s).texts.find((t) =>
      t.text.includes('Reached the position'),
    );
    expect(reached?.speak).toBe(true);
    s.controller.dispose();
  });
});

describe('pacing the session by the voice', () => {
  it('reports busy while the coach answers a cue, and free once it is done', async () => {
    const s = setup();
    await s.controller.start(1);
    await vi.advanceTimersByTimeAsync(200);
    s.voiceBusy.mockClear();
    s.emit({ kind: 'phase', phase: 'PRESENT', pose: 'open', index: 0, rep: 1 });
    expect(s.voiceBusy).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(3000);
    coachTurn(s);
    await vi.advanceTimersByTimeAsync(200);
    expect(s.voiceBusy).toHaveBeenLastCalledWith(false);
    s.controller.dispose();
  });

  it('stays busy while reply audio is still playing after the turn ends', async () => {
    const s = setup();
    await s.controller.start(1);
    s.emit({ kind: 'phase', phase: 'PRESENT', pose: 'open', index: 0, rep: 1 });
    await vi.advanceTimersByTimeAsync(3000);
    s.audio.playing = true;
    coachTurn(s);
    await vi.advanceTimersByTimeAsync(500);
    expect(s.voiceBusy).toHaveBeenLastCalledWith(true);
    s.audio.playing = false;
    await vi.advanceTimersByTimeAsync(200);
    expect(s.voiceBusy).toHaveBeenLastCalledWith(false);
    s.controller.dispose();
  });

  it('reports busy while the patient is talking', async () => {
    const s = setup();
    await s.controller.start(1);
    await vi.advanceTimersByTimeAsync(200);
    transport(s).emit({ type: 'activity', talking: true });
    await vi.advanceTimersByTimeAsync(200);
    expect(s.voiceBusy).toHaveBeenLastCalledWith(true);
    transport(s).emit({ type: 'activity', talking: false });
    await vi.advanceTimersByTimeAsync(200);
    expect(s.voiceBusy).toHaveBeenLastCalledWith(false);
    s.controller.dispose();
  });

  it('releases the session when the voice stops', async () => {
    const s = setup();
    await s.controller.start(1);
    transport(s).emit({ type: 'activity', talking: true });
    await vi.advanceTimersByTimeAsync(200);
    expect(s.voiceBusy).toHaveBeenLastCalledWith(true);
    s.controller.stop();
    expect(s.voiceBusy).toHaveBeenLastCalledWith(false);
    s.controller.dispose();
  });

  it('never calls the session in Simple voice', async () => {
    const s = setup();
    s.controller.setMode('simple');
    await s.controller.start(1);
    s.emit({ kind: 'phase', phase: 'PRESENT', pose: 'open', index: 0, rep: 1 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(s.voiceBusy).not.toHaveBeenCalledWith(true);
    s.controller.dispose();
  });
});

describe('timing log', () => {
  it('records how long a spoken cue took: queued, first sound, last sound', async () => {
    const s = setup();
    await s.controller.start(1);
    s.emit({ kind: 'phase', phase: 'PRESENT', pose: 'open', index: 0, rep: 1 });
    await vi.advanceTimersByTimeAsync(2600); // scheduler spacing after the greeting
    await vi.advanceTimersByTimeAsync(700); // the model starts answering
    coachTurn(s);
    await vi.advanceTimersByTimeAsync(200);
    s.controller.stop();
    await vi.advanceTimersByTimeAsync(100);
    const line = s
      .saved()
      .find((l) => l.text.startsWith('[timing]') && l.text.includes('"cue":"present"'));
    expect(line).toBeDefined();
    const t = JSON.parse(line!.text.slice('[timing] '.length));
    expect(t.attempt).toBe(0);
    expect(t.first_audio_ms).toBeGreaterThanOrEqual(t.queued_ms);
    expect(t.end_ms).toBeGreaterThanOrEqual(t.first_audio_ms);
    expect(t.late).toBe(false);
    s.controller.dispose();
  });
});

describe('the patient request when the coach started help first (live run)', () => {
  it('still goes to the session during ASSIST, and says what it widened', async () => {
    const s = setup();
    await s.controller.start(1);
    const requestHelp = vi.fn();
    s.runtime.exercise.requestHelp = requestHelp;
    s.setView({ phase: 'ASSIST', assisting: true, index: 0 });
    transport(s).emit({
      type: 'transcript',
      role: 'patient',
      text: 'Yes please, help me.',
      finished: true,
    });
    expect(requestHelp).toHaveBeenCalledWith(undefined);
    expect(s.deps.local.speak).toHaveBeenCalledWith(
      'Opening your hand now.',
      expect.any(Function),
    );
    s.controller.dispose();
  });

  it('a "reached" cue is never spoken once the attempt is resting', async () => {
    const s = setup();
    await s.controller.start(1);
    s.setView({ phase: 'HOLD', index: 0 });
    transport(s).emit({ type: 'audio', data: 'AAAA' });
    s.emit({ kind: 'reached', t_rel: 2.4, assisted: false });
    s.setView({ phase: 'REST', index: 0 });
    transport(s).emit({ type: 'turnComplete' });
    await vi.advanceTimersByTimeAsync(3000);
    const reached = transport(s).texts.filter((t) =>
      t.text.includes('Reached the position'),
    );
    expect(reached.every((t) => !t.speak)).toBe(true);
    s.controller.dispose();
  });
});
