import type {
  EngineEvent,
  AttemptResult,
  SessionSummary,
} from '../contracts/engine';
import type { Runtime } from '../contracts/runtime';
import type { Session, TranscriptLine, VoiceToken } from '../contracts/api';
import { ApiRequestError } from '../api/client';
import { BrowserAudio, type VoiceAudio } from './audio';
import { GeminiLiveTransport } from './GeminiLiveTransport';
import type { LiveTransport, TransportEvent } from './transport';
import { BrowserLocalVoice, SafetyNet, type LocalVoice } from './safetyNet';
import { fallbackPhrase } from './fallbackCoach';
import { CueScheduler, eventCue } from './cues';
import { dispatchTool } from './tools';
import { TranscriptBatcher } from './transcript';
export type VoiceMode = 'live' | 'simple' | 'off';
export type VoiceStatus =
  'off' | 'connecting' | 'listening' | 'speaking' | 'paused' | 'fallback';
export interface VoiceState {
  mode: VoiceMode;
  status: VoiceStatus;
  muted: boolean;
  lastCoachLine: string | null;
  lastPatientLine: string | null;
  unavailable: boolean;
  transcriptError: boolean;
}
export interface VoiceDependencies {
  token(id: number | null): Promise<VoiceToken>;
  sessions(): Promise<Session[]>;
  save(id: number, lines: TranscriptLine[]): Promise<void>;
  transport(): LiveTransport;
  audio: VoiceAudio;
  local: LocalVoice;
}
async function withDeadline<T>(operation: Promise<T>, ms = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Voice connection timed out')),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export class VoiceController {
  state: VoiceState = {
    mode: 'live',
    status: 'off',
    muted: false,
    lastCoachLine: null,
    lastPatientLine: null,
    unavailable: false,
    transcriptError: false,
  };
  private listeners = new Set<() => void>();
  private active = false;
  private id: number | null = null;
  private generation = 0;
  private transport?: LiveTransport;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private fallbackTimer?: ReturnType<typeof setTimeout>;
  private captionTimer?: ReturnType<typeof setTimeout>;
  private failures = 0;
  private greeted = false;
  private reconnecting = false;
  private connected = false;
  private safetyUntil = 0;
  private safetySpeaking = false;
  private batches = new Set<TranscriptBatcher>();
  private batch?: TranscriptBatcher;
  private partial = { coach: '', patient: '' };
  private previous: SessionSummary | null = null;
  private lastAttempt: AttemptResult | null = null;
  private recent = '';
  private cancelled = new Set<string>();
  private handled = new Set<string>();
  private scheduler: CueScheduler;
  private safety: SafetyNet;
  private unsubscribe: () => void;
  constructor(
    private runtime: Runtime,
    private deps: VoiceDependencies,
  ) {
    this.scheduler = new CueScheduler((cue) => {
      if (this.connected) this.transport?.sendText(cue.text, cue.speak);
    });
    this.safety = new SafetyNet(
      deps.local,
      () => {
        this.safetySpeaking = true;
        this.safetyUntil = performance.now() + 5000;
        this.scheduler.clear();
        clearTimeout(this.fallbackTimer);
        deps.audio.flush();
        if (this.partial.coach) this.batch?.add('coach', this.partial.coach);
        this.partial.coach = '';
      },
      (text) => {
        this.caption(text, 'system');
        this.update({ status: 'speaking' });
      },
      () => {
        this.safetySpeaking = false;
        this.safetyUntil = performance.now() + 500;
        this.update({
          status: this.active
            ? this.runtime.exercise.view().paused
              ? 'paused'
              : this.state.mode === 'simple'
                ? 'fallback'
                : this.state.mode === 'off'
                  ? 'off'
                  : 'listening'
            : 'off',
        });
      },
    );
    this.unsubscribe = runtime.exercise.onEvent((event) => this.onEvent(event));
  }
  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };
  snapshot = () => this.state;
  private update(value: Partial<VoiceState>) {
    this.state = { ...this.state, ...value };
    this.listeners.forEach((cb) => cb());
  }
  private caption(text: string, role: 'coach' | 'system' = 'coach') {
    this.batch?.add(role, text);
    this.update({ lastCoachLine: text });
    clearTimeout(this.captionTimer);
    this.captionTimer = setTimeout(
      () => this.update({ lastCoachLine: null }),
      8000,
    );
  }
  private speak(text: string) {
    this.deps.local.cancel();
    this.caption(text);
    this.update({ status: 'speaking' });
    this.deps.local.speak(text, () => {
      if (this.active)
        this.update({
          status: this.state.mode === 'simple' ? 'fallback' : 'listening',
        });
    });
  }
  async start(id: number | null) {
    this.stop();
    this.active = true;
    this.id = id;
    this.failures = 0;
    this.greeted = false;
    this.safetyUntil = 0;
    this.safetySpeaking = false;
    this.previous = null;
    this.lastAttempt = null;
    this.partial = { coach: '', patient: '' };
    this.handled.clear();
    this.cancelled.clear();
    this.recent = '';
    this.update({ unavailable: false, transcriptError: false });
    this.deps.local.unlock();
    if (id !== null) {
      this.batch = new TranscriptBatcher(
        (lines) => this.deps.save(id, lines),
        () => this.update({ transcriptError: true }),
      );
      this.batches.add(this.batch);
      this.batch.start();
    }
    const generation = this.generation;
    void this.deps
      .sessions()
      .then((sessions) => {
        if (generation !== this.generation) return;
        const current = sessions.find((s) => s.id === id);
        this.previous =
          sessions.find(
            (s) =>
              s.id !== id &&
              s.summary &&
              (!current || s.is_demo === current.is_demo),
          )?.summary ?? null;
      })
      .catch(() => {});
    if (this.state.mode === 'simple') {
      this.simple(false);
      return;
    }
    if (this.state.mode === 'off') return;
    await this.connect(generation);
  }
  private async connect(generation: number) {
    if (
      !this.active ||
      generation !== this.generation ||
      this.state.mode !== 'live'
    )
      return;
    this.update({ status: 'connecting' });
    const transport = this.deps.transport();
    this.cancelled.clear();
    this.handled.clear();
    this.transport = transport;
    try {
      const token = await withDeadline(this.deps.token(this.id));
      if (generation !== this.generation) return;
      await withDeadline(
        transport.connect(token, (event) => {
          if (generation === this.generation && this.transport === transport)
            this.receive(event);
        }),
      );
      if (generation !== this.generation || this.transport !== transport) {
        transport.close();
        return;
      }
      await this.deps.audio.open((data) => {
        if (
          this.connected &&
          !this.state.muted &&
          !this.safetySpeaking &&
          performance.now() >= this.safetyUntil
        )
          transport.sendAudio(data);
      });
      if (generation !== this.generation || this.transport !== transport) {
        this.deps.audio.close();
        transport.close();
        return;
      }
      this.connected = true;
      this.reconnecting = false;
      this.deps.audio.setMuted(this.state.muted);
      this.update({ status: 'listening' });
      const view = this.runtime.exercise.view();
      transport.sendText(
        `[session] ${this.greeted || this.failures ? 'Reconnected' : 'Starting'}: ${view.total} attempts. Current pose ${view.pose.name}, rep ${view.rep}, phase ${view.phase}. Instruction: ${view.pose.instruction}. Previous session: ${JSON.stringify(this.previous)}. Active movement: ${JSON.stringify(view.activeMax)}. Recent context: ${this.recent || 'none'}. Greet briefly and give the current instruction if PRESENT.`,
        true,
      );
      this.greeted = true;
      this.failures = 0;
    } catch (error) {
      if (generation !== this.generation || this.transport !== transport)
        return;
      if (
        (error instanceof ApiRequestError && error.status === 503) ||
        (error instanceof DOMException &&
          ['NotAllowedError', 'NotFoundError'].includes(error.name))
      ) {
        this.simple(true);
        return;
      }
      this.retry();
    }
  }
  private retry() {
    if (!this.active || this.state.mode !== 'live' || this.reconnecting) return;
    this.reconnecting = true;
    this.connected = false;
    this.transport?.close();
    this.transport = undefined;
    this.deps.audio.close();
    this.scheduler.clear();
    this.finishTranscripts();
    if (this.failures >= 3) {
      this.simple(true);
      return;
    }
    const delay = [1000, 3000, 6000][this.failures++];
    this.update({ status: 'connecting' });
    this.reconnectTimer = setTimeout(() => {
      this.reconnecting = false;
      void this.connect(this.generation);
    }, delay);
  }
  private simple(unavailable: boolean) {
    this.disconnect();
    this.update({ mode: 'simple', status: 'fallback', unavailable });
    if (this.active && !this.safetySpeaking)
      this.speak(
        `Let's practice together. ${this.runtime.exercise.view().pose.instruction}`,
      );
  }
  private receive(event: TransportEvent) {
    switch (event.type) {
      case 'closed':
        this.retry();
        break;
      case 'audio':
        if (!this.safetySpeaking && performance.now() >= this.safetyUntil) {
          this.deps.audio.play(event.data);
          this.scheduler.noteCoachSpeech();
          this.update({ status: 'speaking' });
        }
        break;
      case 'interrupt':
        this.deps.audio.flush();
        this.finishTranscript('coach');
        break;
      case 'activity':
        this.scheduler.setTalking(event.talking);
        break;
      case 'transcript':
        if (
          event.role === 'coach' &&
          (this.safetySpeaking || performance.now() < this.safetyUntil)
        )
          break;
        if (event.role === 'coach') clearTimeout(this.captionTimer);
        if (event.role === 'patient')
          this.scheduler.setTalking(!event.finished);
        this.partial[event.role] += event.text;
        this.update(
          event.role === 'coach'
            ? { lastCoachLine: this.partial.coach }
            : { lastPatientLine: this.partial.patient },
        );
        if (event.finished) this.finishTranscript(event.role);
        break;
      case 'turnComplete':
        this.finishTranscripts();
        this.scheduler.setTalking(false);
        this.update({
          status: this.runtime.exercise.view().paused ? 'paused' : 'listening',
        });
        break;
      case 'cancelTools':
        event.ids.forEach((id) => this.cancelled.add(id));
        break;
      case 'tools':
        for (const call of event.calls) {
          if (this.cancelled.has(call.id) || this.handled.has(call.id))
            continue;
          this.handled.add(call.id);
          const transport = this.transport;
          void dispatchTool(this.runtime, call, this.previous).then(
            (response) => {
              if (transport === this.transport && !this.cancelled.has(call.id))
                transport?.respond(call, response);
            },
          );
        }
    }
  }
  private finishTranscript(role: 'coach' | 'patient') {
    const text = this.partial[role];
    this.partial[role] = '';
    if (!text) return;
    if (role === 'coach') {
      this.caption(text);
      this.scheduler.noteCoachSpeech();
    } else this.batch?.add(role, text);
  }
  private finishTranscripts() {
    this.finishTranscript('coach');
    this.finishTranscript('patient');
  }
  private onEvent(event: EngineEvent) {
    // Always armed, including Off and before start(). Pages never forward events.
    if (this.safety.handle(event)) {
      if (this.connected) {
        const cue = eventCue(event, this.runtime.exercise.view());
        if (cue) this.transport?.sendText(cue.text, false);
      }
      return;
    }
    if (!this.active || this.state.mode === 'off') return;
    const view = this.runtime.exercise.view();
    if (event.kind === 'phase' && event.phase === 'PAUSED') {
      this.scheduler.clear();
      this.deps.audio.flush();
      if (!this.safetySpeaking) this.deps.local.cancel();
      this.update({ status: this.safetySpeaking ? 'speaking' : 'paused' });
      return;
    }
    if ((view.paused || this.safetySpeaking) && event.kind !== 'session_done')
      return;
    if (event.kind === 'phase' && event.phase === 'ATTEMPT')
      this.deps.local.tone('cue');
    if (event.kind === 'reached') this.deps.local.tone('reached');
    if (event.kind === 'assist_started') this.deps.local.tone('assist');
    const cue = eventCue(event, view, this.lastAttempt);
    if (event.kind === 'attempt_done') this.lastAttempt = event.result;
    if (cue) this.recent = cue.text;
    if (
      this.state.mode === 'live' &&
      cue &&
      performance.now() >= this.safetyUntil
    )
      this.scheduler.push(cue, event);
    if (this.state.mode === 'simple' && !this.safetySpeaking) {
      const phrase = fallbackPhrase(event);
      if (phrase) {
        clearTimeout(this.fallbackTimer);
        const delay = Math.max(0, this.safetyUntil - performance.now());
        if (delay)
          this.fallbackTimer = setTimeout(() => this.speak(phrase), delay);
        else this.speak(phrase);
      }
    }
    if (event.kind === 'session_done') {
      this.finishTranscripts();
      void this.batch?.flush();
    }
  }
  setMuted(muted: boolean) {
    this.update({ muted });
    this.deps.audio.setMuted(muted);
    if (muted) this.transport?.endAudio();
  }
  setMode(mode: VoiceMode) {
    if (mode === this.state.mode) return;
    this.generation++;
    this.disconnect();
    this.update({ mode, status: 'off', unavailable: false });
    if (!this.active) return;
    if (mode === 'simple') this.simple(false);
    if (mode === 'live') {
      this.failures = 0;
      void this.connect(this.generation);
    }
  }
  private disconnect() {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.fallbackTimer);
    this.reconnecting = false;
    this.connected = false;
    this.transport?.close();
    this.transport = undefined;
    this.deps.audio.close();
    if (!this.safetySpeaking) this.deps.local.cancel();
    this.scheduler.clear();
    this.scheduler.setTalking(false);
  }
  stop() {
    this.generation++;
    this.active = false;
    this.disconnect();
    this.finishTranscripts();
    const batch = this.batch;
    this.batch = undefined;
    void batch?.stop();
    this.update({ status: 'off' });
  }
  dispose() {
    this.stop();
    this.unsubscribe();
    clearTimeout(this.captionTimer);
    this.batches.forEach((batch) => batch.dispose());
    this.batches.clear();
    this.deps.local.dispose();
    this.listeners.clear();
  }
}
export const browserVoiceDependencies = {
  transport: () => new GeminiLiveTransport(),
  audio: () => new BrowserAudio(),
  local: () => new BrowserLocalVoice(),
};
