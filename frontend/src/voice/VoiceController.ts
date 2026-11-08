import { poseInstruction } from './fallbackCoach';
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
import type { LiveTransport, ToolCall, TransportEvent } from './transport';
import { BrowserLocalVoice, SafetyNet, type LocalVoice } from './safetyNet';
import { fallbackPhrase } from './fallbackCoach';
import { CueScheduler, cueValidity, eventCue, type Cue } from './cues';
import type { GloveFinger } from '../contracts/glove';
import { fingerName } from './fingerNames';
import { liveContext, movementContext, summaryContext } from './context';
import { claimsGloveHelp, HONESTY_CORRECTION } from './honesty';

/** A tool call can arrive just after the words that describe it. */
const HELP_CLAIM_GRACE_MS = 1500;
/** Pause after which an unfinished help request is taken as complete. */
const HELP_SENTENCE_MS = 700;
/** How often the controller tells the session whether the voice is busy. */
const PACE_MS = 100;
/** Never keep the coach muted for a local help announcement longer than this. */
const LOCAL_HELP_MAX_MS = 4000;

/**
 * Said by the app the moment the glove starts helping, without waiting for the coach.
 * No consent or stop words ("help", "yes", "ok", "stop"): if the microphone picks up this
 * phrase, it can never count as the patient asking for help or braking.
 */
export function helpPhrase(fingers: readonly GloveFinger[]): string {
  const names = fingers.map(fingerName);
  if (!names.length || names.length >= 5) return 'Opening your hand now.';
  if (names.length >= 3) return 'Opening your fingers now.';
  return `Opening your ${names.join(' and ')} now.`;
}
import { dispatchTool } from './tools';
import { TranscriptBatcher } from './transcript';
import {
  patientBrakeReason,
  reportedPain,
  normalizePatientText,
  namedFingers,
} from './patientSafety';
import {
  type PatientTranscriber,
  BrowserPatientTranscriber,
} from './patientTranscriber';
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
  /** Live is on but the microphone is blocked or busy: the coach talks, cannot hear. */
  micBlocked: boolean;
}
export interface VoiceDependencies {
  token(id: number | null): Promise<VoiceToken>;
  sessions(): Promise<Session[]>;
  save(id: number, lines: TranscriptLine[]): Promise<void>;
  transport(): LiveTransport;
  audio: VoiceAudio;
  local: LocalVoice;
  patient?: PatientTranscriber;
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
    micBlocked: false,
  };
  private listeners = new Set<() => void>();
  private active = false;
  private id: number | null = null;
  private generation = 0;
  private transport?: LiveTransport;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private fallbackTimer?: ReturnType<typeof setTimeout>;
  private captionTimer?: ReturnType<typeof setTimeout>;
  private liveTimer?: ReturnType<typeof setInterval>;
  private checkedAttempts = new Set<number>();
  private awaitingPainUntil = 0;
  private patientBraked = false;
  /** After an on-screen Brake, the coach stays quiet until the patient speaks. */
  private quietUntilPatient = false;
  /** Attempt index the patient already asked help for (once per attempt). */
  private helpAskedFor = -1;
  /** A help request waits for the end of the sentence, which may name fingers. */
  private helpTimer: ReturnType<typeof setTimeout> | undefined;
  private helpText = '';
  /** Outbox: context and the next spoken cue wait until nobody is speaking. */
  private context: string[] = [];
  private spoken: Cue | null = null;
  private coachTalking = false;
  private patientTalking = false;
  private coachQuietTimer?: ReturnType<typeof setTimeout>;
  private outboxTimer?: ReturnType<typeof setTimeout>;
  /** PRESENT re-prompts for the same attempt, and a rotating phrase variant (Simple voice). */
  private presentIndex = -1;
  private presentRepeats = 0;
  private phraseVariant = 0;
  /** After session_done: let the coach finish its goodbye, then hang up. */
  private ending = false;
  private coachSpokeSinceEnd = false;
  private endTimer?: ReturnType<typeof setTimeout>;
  private brakeLatched = false;
  /** When the runtime last accepted a help tool (help now, help sooner, intensity). */
  private helpAppliedAt = -Infinity;
  private correctedAt = -Infinity;
  private failures = 0;
  private greeted = false;
  private reconnecting = false;
  private connected = false;
  private safetyUntil = 0;
  private safetySpeaking = false;
  private batches = new Set<TranscriptBatcher>();
  private batch?: TranscriptBatcher;
  /** The app's own short help announcement is playing; the coach waits. */
  private localSpeaking = false;
  private localTimer?: ReturnType<typeof setTimeout>;
  /** Last busy state sent to the session (runtime.exercise.voiceBusy). */
  private busySent = false;
  private paceTimer?: ReturnType<typeof setInterval>;
  /** The spoken cue the coach is answering now, for the [timing] log. */
  private inFlight: {
    label: string;
    index: number | null;
    at: number;
    sentAt: number;
    firstAudioAt: number | null;
    phaseStart: string | null;
    turnDone: boolean;
  } | null = null;
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
    this.scheduler = new CueScheduler((cue) => this.outbox(cue));
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
    // A fallback forced by a Live failure (not chosen by the user) is per session: every new
    // session tries Gemini Live again instead of staying on the robotic browser voice.
    const forcedSimple = this.state.mode === 'simple' && this.state.unavailable;
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
    this.checkedAttempts.clear();
    this.awaitingPainUntil = 0;
    this.brakeLatched = false;
    this.patientBraked = false;
    this.quietUntilPatient = false;
    this.presentIndex = -1;
    this.presentRepeats = 0;
    this.ending = false;
    this.coachSpokeSinceEnd = false;
    clearTimeout(this.endTimer);
    // No per-second [live] stream: every message to Gemini Live can cut off the answer it
    // is preparing (the coach sounded chopped and never answered). The latest live state
    // rides along with the next message instead (see flushOutbox).
    this.context = [];
    this.spoken = null;
    this.coachTalking = false;
    this.patientTalking = false;
    this.update({
      unavailable: false,
      transcriptError: false,
      micBlocked: false,
      ...(forcedSimple ? { mode: 'live' as const } : {}),
    });
    this.deps.local.unlock();
    if (id !== null) this.record(id);
    const generation = this.generation;
    this.loadPrevious(id, generation);
    if (this.state.mode === 'simple') {
      this.simple(false);
      return;
    }
    if (this.state.mode === 'off') return;
    await this.connect(generation);
  }
  /**
   * The session got its server id after the coach had started (a slow or offline save). Keep
   * coaching as is (no restart, no second greeting); save the transcript from now on and use the
   * right previous session for context.
   */
  attach(id: number) {
    if (!this.active || this.id !== null) return;
    this.id = id;
    this.record(id);
    this.loadPrevious(id, this.generation);
  }
  private record(id: number) {
    this.batch = new TranscriptBatcher(
      (lines) => this.deps.save(id, lines),
      () => this.update({ transcriptError: true }),
    );
    this.batches.add(this.batch);
    this.batch.start();
  }
  private loadPrevious(id: number | null, generation: number) {
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
              (s.assist_direction ?? 'close') ===
                (current ? (current.assist_direction ?? 'close') : 'open') &&
              (!current ||
                (s.is_demo === current.is_demo &&
                  (s.started_at < current.started_at ||
                    (s.started_at === current.started_at &&
                      s.id < current.id)))),
          )?.summary ?? null;
      })
      .catch(() => {});
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
      const mic = await this.deps.audio.open((data) => {
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
      clearInterval(this.paceTimer);
      this.paceTimer = setInterval(() => this.pace(), PACE_MS);
      this.update({ micBlocked: mic === false });
      this.deps.audio.setMuted(this.state.muted);
      this.update({ status: 'listening' });
      const view = this.runtime.exercise.view();
      transport.sendText(
        `[session] ${this.greeted || this.failures ? 'Reconnected' : 'Starting'}: ${view.total} attempts. Current pose ${view.pose.name}, rep ${view.rep}, phase ${view.phase}. Instruction: ${poseInstruction(view.pose.id)} Previous session: ${summaryContext(this.previous)} Active movement (closure/target): ${movementContext(view)}. Recent context: ${this.recent || 'none'}. Greet briefly and give the current instruction if PRESENT.`,
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
    this.listenSimple();
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
        if (
          !this.quietUntilPatient &&
          !this.safetySpeaking &&
          !this.localSpeaking &&
          performance.now() >= this.safetyUntil
        ) {
          if (this.inFlight && this.inFlight.firstAudioAt === null) {
            this.inFlight.firstAudioAt = performance.now();
            this.inFlight.phaseStart = this.runtime.exercise.view().phase;
          }
          this.deps.audio.play(event.data);
          this.markCoachTalking();
          if (this.ending) this.coachSpokeSinceEnd = true;
          this.scheduler.noteCoachSpeech();
          this.update({ status: 'speaking' });
        }
        break;
      case 'interrupt':
        this.deps.audio.flush();
        this.finishTranscript('coach');
        this.coachDone();
        break;
      case 'activity':
        this.scheduler.setTalking(event.talking);
        this.patientTalking = event.talking;
        if (!event.talking) this.flushOutbox();
        break;
      case 'transcript':
        if (
          event.role === 'coach' &&
          (this.quietUntilPatient ||
            this.safetySpeaking ||
            this.localSpeaking ||
            performance.now() < this.safetyUntil)
        )
          break;
        if (event.role === 'patient' && event.text.trim())
          this.quietUntilPatient = false;
        if (event.role === 'coach') clearTimeout(this.captionTimer);
        this.partial[event.role] += event.text;
        if (event.role === 'patient') {
          this.checkPatientSafety(this.partial.patient);
          this.checkHelpRequest(this.partial.patient, !!event.finished);
          this.runtime.therapy?.notePatientSpeech?.(this.partial.patient);
          this.scheduler.setTalking(!event.finished);
        }
        this.update(
          event.role === 'coach'
            ? { lastCoachLine: cleanCoachText(this.partial.coach) }
            : { lastPatientLine: this.partial.patient },
        );
        if (event.finished) this.finishTranscript(event.role);
        break;
      case 'turnComplete':
        if (this.inFlight) this.inFlight.turnDone = true;
        this.finishTranscripts();
        this.scheduler.setTalking(false);
        this.patientTalking = false;
        this.coachDone();
        if (this.ending && this.coachSpokeSinceEnd) {
          clearTimeout(this.endTimer);
          // Let the last audio drain before hanging up.
          this.endTimer = setTimeout(() => this.finishSession(), 1500);
        }
        this.update({
          status: this.safetySpeaking
            ? 'speaking'
            : this.runtime.exercise.view().paused
              ? 'paused'
              : 'listening',
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
          if (
            this.brakeLatched &&
            ![
              'get_live_state',
              'get_progress',
              'record_feeling',
              'brake',
              'pause_session',
              'stop_session',
              'repeat_instruction',
              'highlight_finger',
              'note_for_therapist',
            ].includes(call.name)
          ) {
            const response = {
              ok: false,
              reason:
                'Patient brake is active. Wait for an explicit request to continue.',
            };
            this.auditTool(call, response, this.batch);
            transport?.respond(call, response);
            continue;
          }
          const batch = this.batch;
          const response = dispatchTool(this.runtime, call, this.previous);
          // Runtime braking is synchronous, even though tool responses are promises.
          const braking =
            this.runtime.therapy &&
            (call.name === 'brake' ||
              (call.name === 'record_feeling' &&
                typeof call.args?.pain === 'number' &&
                call.args.pain >= 4));
          if (braking) this.brakeLatched = true;
          void response.then((response) => {
            this.auditTool(call, response, batch);
            if (
              response.ok === true &&
              (call.name === 'assist_finger_now' ||
                call.name === 'intensify' ||
                (call.name === 'adjust_help' &&
                  call.args?.direction === 'more'))
            )
              this.helpAppliedAt = performance.now();
            if (transport === this.transport && !this.cancelled.has(call.id)) {
              if (braking && response.ok === true)
                this.safety.announce(
                  'Stopped. The glove has released. Tell me how you feel.',
                );
              transport?.respond(call, response);
            }
          });
        }
    }
  }
  private auditTool(
    call: ToolCall,
    response: Record<string, unknown>,
    batch: TranscriptBatcher | undefined,
  ) {
    // Runtime mutation decisions carry applied/clamped args; transcript auditing
    // also preserves read/legacy tools and voice-level rejections for replay.
    batch?.add(
      'system',
      '[tool] ' +
        JSON.stringify({
          id: call.id,
          tool: call.name,
          requested: call.args ?? {},
          response,
        }),
    );
    // A stop tool may finish after the provider stopped or started a new session.
    // Keep its result in the original session, including after its final flush.
    if (batch && batch !== this.batch) void batch.flush();
  }
  private finishTranscript(role: 'coach' | 'patient') {
    const raw = this.partial[role];
    this.partial[role] = '';
    const text = role === 'coach' ? cleanCoachText(raw) : raw;
    if (!text) return;
    if (role === 'coach') {
      this.caption(text);
      this.scheduler.noteCoachSpeech();
      if (claimsGloveHelp(text)) this.checkHelpClaim(text);
    } else {
      this.batch?.add(role, text);
      if (
        reportedPain(text, performance.now() < this.awaitingPainUntil) !== null
      )
        this.awaitingPainUntil = 0;
      if (
        /^(?:(?:yes|okay|ok|please|si|por favor) )?(?:continue|resume|continuar|continua)(?: (?:please|now|practice|por favor))?[. ]*$/.test(
          normalizePatientText(text),
        )
      )
        this.brakeLatched = false;
      this.patientBraked = false;
    }
  }
  /**
   * A coach line said the glove helps. Give a tool that arrives with the speech a moment,
   * then compare with what the runtime did; if nothing was applied, correct the coach and
   * mark it in the session transcript for review.
   */
  private checkHelpClaim(text: string) {
    const transport = this.transport;
    const batch = this.batch;
    setTimeout(() => {
      const now = performance.now();
      const helping = this.runtime.therapy
        ?.state()
        ?.fingers.some((finger) => finger.glove_helping);
      if (
        helping ||
        now - this.helpAppliedAt < 15_000 ||
        now - this.correctedAt < 10_000 ||
        this.brakeLatched ||
        transport !== this.transport
      )
        return;
      this.correctedAt = now;
      batch?.add(
        'system',
        '[honesty] The coach said the glove was helping, but no help was applied: ' +
          JSON.stringify(text),
      );
      transport?.sendText(HONESTY_CORRECTION, true);
    }, HELP_CLAIM_GRACE_MS);
  }
  /** The patient pressed Brake on screen: silence the coach, say so locally and tell the model. */
  brake(reason = 'You pressed Brake.') {
    this.brakeLatched = true;
    this.patientBraked = true;
    this.quietUntilPatient = true;
    this.scheduler.clear();
    this.deps.audio.flush();
    this.partial.coach = '';
    this.safety.announce(
      'Stopped. The glove has released. Tell me how you feel.',
    );
    this.transport?.sendText(
      `[safety] ${reason} The patient pressed Brake on screen. Released and paused; already announced. Stop giving instructions and never resume without the patient's request.`,
      false,
    );
  }
  /** Non-safety messages to the coach: merged, and sent only when nobody is speaking. */
  private outbox(cue: Cue) {
    if (!this.connected) return;
    if (cue.speak && this.stale(cue)) cue = this.unspoken(cue);
    if (cue.speak) {
      // A newer spoken cue replaces an older one, unless the older one presents a pose.
      if (this.spoken?.present && !cue.present) this.context.push(cue.text);
      else {
        if (this.spoken) this.context.push(this.spoken.text);
        this.spoken = cue;
      }
    } else this.context.push(cue.text);
    this.flushOutbox();
  }
  private flushOutbox() {
    clearTimeout(this.outboxTimer);
    if (!this.connected || !this.transport) return;
    if (this.spoken && this.stale(this.spoken)) {
      this.context.push(this.unspoken(this.spoken).text);
      this.spoken = null;
    }
    if (!this.context.length && !this.spoken) return;
    if (
      this.coachTalking ||
      this.patientTalking ||
      this.safetySpeaking ||
      this.localSpeaking
    ) {
      // Retry later; never hold messages forever if an end-of-turn signal is lost.
      this.outboxTimer = setTimeout(() => this.flushOutbox(), 1000);
      return;
    }
    const state = this.runtime.therapy?.state();
    const live =
      state &&
      ['ATTEMPT', 'ASSIST', 'HOLD', 'ASSIST_HOLD'].includes(state.phase)
        ? [liveContext(state)]
        : [];
    const parts = [
      ...this.context,
      ...live,
      ...(this.spoken ? [this.spoken.text] : []),
    ];
    const speak = !!this.spoken;
    if (this.spoken) this.startTiming(this.spoken);
    this.context = [];
    this.spoken = null;
    // Only the latest of repeated context lines matters; keep the message short.
    this.transport.sendText(parts.slice(-6).join('\n'), speak);
    if (speak) this.markCoachTalking(); // until its reply ends (or 6 s of silence)
  }
  /** The cue is no longer true: saying it now would mislead the patient. */
  private stale(cue: Cue): boolean {
    return !!cue.valid && !cue.valid(this.runtime.exercise.view());
  }
  private unspoken(cue: Cue): Cue {
    this.batch?.add(
      'system',
      '[timing] ' +
        JSON.stringify({
          cue: cue.label ?? 'cue',
          attempt: cue.index ?? null,
          dropped: 'out of date before the coach could say it',
          after_ms: cue.at === undefined ? null : Math.round(performance.now() - cue.at),
        }),
    );
    return {
      text: `${cue.text} (Already over: do not mention it.)`,
      speak: false,
    };
  }
  private startTiming(cue: Cue) {
    this.finishTiming();
    const now = performance.now();
    this.inFlight = {
      label: cue.label ?? 'cue',
      index: cue.index ?? null,
      at: cue.at ?? now,
      sentAt: now,
      firstAudioAt: null,
      phaseStart: null,
      turnDone: false,
    };
  }
  /** Log how long the patient waited for this cue: queued, first sound, last sound. */
  private finishTiming() {
    const t = this.inFlight;
    if (!t) return;
    this.inFlight = null;
    const now = performance.now();
    const view = this.runtime.exercise.view();
    this.batch?.add(
      'system',
      '[timing] ' +
        JSON.stringify({
          cue: t.label,
          attempt: t.index,
          queued_ms: Math.round(t.sentAt - t.at),
          first_audio_ms:
            t.firstAudioAt === null ? null : Math.round(t.firstAudioAt - t.at),
          end_ms: Math.round(now - t.at),
          phase_start: t.phaseStart,
          phase_end: view.phase,
          late: t.index !== null && view.index !== t.index,
        }),
    );
  }
  private audioPlaying(): boolean {
    return this.deps.audio.playing === true;
  }
  /** Talking, about to talk, or listening: the session should wait for the voice. */
  private busy(): boolean {
    return (
      this.active &&
      this.state.mode === 'live' &&
      this.connected &&
      (this.coachTalking ||
        this.patientTalking ||
        this.safetySpeaking ||
        this.localSpeaking ||
        !!this.spoken ||
        this.scheduler.hasPending() ||
        this.audioPlaying())
    );
  }
  /** Keep the session paced by the voice, and close timing records once audio ends. */
  private pace() {
    const busy = this.busy();
    if (busy !== this.busySent) {
      this.busySent = busy;
      this.runtime.exercise.voiceBusy?.(busy);
    }
    if (this.inFlight?.turnDone && !this.audioPlaying()) this.finishTiming();
  }
  /** The glove just started helping: say so at once, locally, over the coach. */
  private announceHelp(fingers: readonly GloveFinger[]) {
    if (this.safetySpeaking) return;
    const phrase = helpPhrase(fingers);
    this.deps.audio.flush();
    if (this.partial.coach)
      this.batch?.add('coach', cleanCoachText(this.partial.coach));
    this.partial.coach = '';
    this.localSpeaking = true;
    const generation = this.generation;
    const done = () => {
      if (generation !== this.generation || !this.localSpeaking) return;
      clearTimeout(this.localTimer);
      this.localSpeaking = false;
      this.pace();
      this.flushOutbox();
    };
    clearTimeout(this.localTimer);
    this.localTimer = setTimeout(done, LOCAL_HELP_MAX_MS);
    this.deps.local.cancel();
    this.caption(phrase, 'system');
    this.deps.local.speak(phrase, done);
  }
  private markCoachTalking() {
    this.coachTalking = true;
    clearTimeout(this.coachQuietTimer);
    // If the end-of-turn signal never arrives, consider the coach done 6 s after its audio.
    this.coachQuietTimer = setTimeout(() => this.coachDone(), 6000);
  }
  private coachDone() {
    clearTimeout(this.coachQuietTimer);
    this.coachTalking = false;
    this.flushOutbox();
  }
  /**
   * The glove only moves when the patient asks. "help" / "ayuda" always counts during an
   * attempt; a plain "yes" / "si" / "dale" counts right after help was offered.
   */
  private checkHelpRequest(text: string, finished: boolean) {
    const view = this.runtime.exercise.view();
    if (view.phase !== 'ATTEMPT' || this.helpAskedFor === view.index) return;
    const said = normalizePatientText(text);
    const asks =
      /\b(help|ayuda|ayudame|ayudar|ayudes)\b/.test(said) ||
      (!!view.helpOffered &&
        /^(yes|yeah|yep|sure|please|si|dale|bueno|ok|okay|por favor)\b/.test(
          said,
        ));
    if (!asks) return;
    // Speech arrives in pieces: "help" can come before "my index and middle". Wait for
    // the end of the sentence (or a short pause) so the request covers the named fingers.
    this.helpText = text;
    clearTimeout(this.helpTimer);
    const index = view.index;
    const send = () => {
      const now = this.runtime.exercise.view();
      if (now.phase !== 'ATTEMPT' || now.index !== index) return;
      if (this.helpAskedFor === index || this.brakeLatched) return;
      this.helpAskedFor = index;
      // "Help my index" helps the index; "help" or "the whole hand" helps every finger.
      const fingers = namedFingers(this.helpText);
      this.runtime.exercise.requestHelp(fingers.length ? fingers : undefined);
    };
    if (finished) send();
    else this.helpTimer = setTimeout(send, HELP_SENTENCE_MS);
  }
  private checkPatientSafety(text: string) {
    const awaitingPain = performance.now() < this.awaitingPainUntil;
    const reason = patientBrakeReason(text, awaitingPain);
    if (!reason) return;
    if (this.patientBraked) return;
    this.patientBraked = true;
    this.brakeLatched = true;
    // No await: release/pause happens before local speech or any model reply.
    if (this.runtime.therapy) this.runtime.therapy.brake(reason, 'local_rule');
    else this.runtime.exercise.pause(); // Pre-A1 runtime pause also releases.
    this.safety.announce(
      'Stopped. The glove has released. Tell me how you feel.',
    );
    this.transport?.sendText(
      `[safety] ${reason} Released and paused locally; already announced. Never resume without the patient's request.`,
      false,
    );
  }
  private listenSimple() {
    this.deps.patient?.stop();
    if (!this.active || this.state.mode !== 'simple' || this.state.muted)
      return;
    this.deps.patient?.start((text, finished) => {
      if (!this.active || this.state.mode !== 'simple' || this.state.muted)
        return;
      this.partial.patient = text;
      if (text.trim()) this.quietUntilPatient = false;
      this.checkPatientSafety(text);
      this.checkHelpRequest(text, !!finished);
      this.runtime.therapy?.notePatientSpeech?.(text);
      this.update({ lastPatientLine: text });
      if (finished) this.finishTranscript('patient');
    });
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
    if (event.kind === 'phase' && event.phase !== 'PAUSED') {
      this.brakeLatched = false;
      this.quietUntilPatient = false;
    }
    if ((view.paused || this.safetySpeaking) && event.kind !== 'session_done')
      return;
    if (event.kind === 'phase' && event.phase === 'ATTEMPT')
      this.deps.local.tone('cue');
    if (event.kind === 'reached') this.deps.local.tone('reached');
    if (event.kind === 'assist_started') this.deps.local.tone('assist');
    let cue = eventCue(event, view, this.lastAttempt);
    // The engine re-sends PRESENT every 8 s while it cannot see the hand. Never repeat
    // the pose: ask once to see the hand, then stay quiet until it is visible.
    let repeatPresent = false;
    if (event.kind === 'phase' && event.phase === 'PRESENT') {
      if (this.presentIndex === event.index) {
        repeatPresent = true;
        this.presentRepeats++;
        cue =
          this.presentRepeats === 1
            ? {
                text: "[session] Still can't see the hand for this pose. Ask once, briefly, to raise it into the camera. Do not repeat the pose.",
                speak: true,
              }
            : {
                text: '[session] Still waiting to see the hand.',
                speak: false,
              };
      } else {
        this.presentIndex = event.index;
        this.presentRepeats = 0;
      }
    }
    const checkIn =
      event.kind === 'attempt_done' &&
      !event.result.interrupted &&
      (event.result.index + 1) % 3 === 0 &&
      !this.checkedAttempts.has(event.result.index);
    if (checkIn) {
      this.checkedAttempts.add(event.result.index);
      this.awaitingPainUntil = performance.now() + 30000;
      if (cue) {
        cue.text = cue.text.replace(
          ' Do not speak yet; you will react with the next pose.',
          '',
        );
        cue.text +=
          ' [check-in] Ask for pain, then fatigue, each from 0 to 10. Record both reported ratings with record_feeling; ask for missing values.';
        cue.speak = true;
      }
    }
    if (event.kind === 'attempt_done') this.lastAttempt = event.result;
    if (cue) {
      cue = {
        ...cue,
        label:
          event.kind === 'phase'
            ? `${event.phase.toLowerCase()}${repeatPresent ? '_repeat' : ''}`
            : checkIn
              ? 'check_in'
              : event.kind,
        at: performance.now(),
        index: view.index,
        valid: checkIn ? undefined : cueValidity(event, view.index),
      };
      if (
        event.kind === 'assist_started' &&
        this.state.mode === 'live' &&
        this.active
      ) {
        // F2: the app says it now; the coach only learns it, so it never says it late.
        this.announceHelp(event.fingers);
        cue = {
          ...cue,
          text: `${cue.text} The app already said so out loud; do not announce it again.`,
          speak: false,
        };
      }
    }
    if (cue) this.recent = cue.text;
    if (
      this.state.mode === 'live' &&
      cue &&
      performance.now() >= this.safetyUntil
    )
      this.scheduler.push(cue, event);
    this.pace();
    if (this.state.mode === 'simple' && !this.safetySpeaking) {
      const phrase = checkIn
        ? 'Nice work. Rate pain, then fatigue, from zero to ten.'
        : repeatPresent
          ? this.presentRepeats === 1
            ? "I can't see your hand yet. Raise it in front of the camera."
            : null
          : fallbackPhrase(event, this.phraseVariant++);
      if (phrase) {
        clearTimeout(this.fallbackTimer);
        const delay = Math.max(0, this.safetyUntil - performance.now());
        if (delay)
          this.fallbackTimer = setTimeout(() => this.speak(phrase), delay);
        else this.speak(phrase);
      }
    }
    if (event.kind === 'session_done') {
      clearInterval(this.liveTimer);
      this.deps.patient?.stop();
      // Save what is complete now (summary and history read it); keep the coach's current
      // sentence whole: it is saved when its turn ends or when the coach hangs up.
      this.finishTranscript('patient');
      void this.batch?.flush();
      this.ending = true;
      clearTimeout(this.endTimer);
      // Live: hang up after the goodbye turn; never wait more than 15 s.
      this.endTimer = setTimeout(
        () => this.finishSession(),
        this.state.mode === 'live' && this.connected ? 15000 : 4000,
      );
    }
  }
  setMuted(muted: boolean) {
    this.update({ muted });
    this.deps.audio.setMuted(muted);
    if (this.state.mode === 'simple') this.listenSimple();
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
    this.deps.patient?.stop();
    this.transport?.close();
    this.transport = undefined;
    this.deps.audio.close();
    if (!this.safetySpeaking) this.deps.local.cancel();
    this.scheduler.clear();
    this.scheduler.setTalking(false);
  }
  /** The session ended: save the last lines and hang up the coach. */
  private finishSession() {
    if (!this.ending) return;
    this.ending = false;
    this.coachSpokeSinceEnd = false;
    this.finishTranscripts();
    this.stop();
  }
  stop() {
    clearInterval(this.paceTimer);
    clearTimeout(this.localTimer);
    this.localSpeaking = false;
    this.finishTiming();
    if (this.busySent) {
      this.busySent = false;
      this.runtime.exercise.voiceBusy?.(false);
    }
    clearTimeout(this.endTimer);
    clearTimeout(this.outboxTimer);
    clearTimeout(this.coachQuietTimer);
    this.generation++;
    this.active = false;
    clearInterval(this.liveTimer);
    this.disconnect();
    this.finishTranscripts();
    const batch = this.batch;
    this.batch = undefined;
    void batch?.stop();
    this.update({ status: 'off' });
  }
  dispose() {
    clearTimeout(this.helpTimer);
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
  patient: () => new BrowserPatientTranscriber(),
};

/** Gemini Live marks silent turns with tags such as "<no speech>"; never show or store them. */
export function cleanCoachText(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/<[^>]*$/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
