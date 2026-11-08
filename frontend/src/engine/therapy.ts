import type {
  ExercisePlanItem,
  ExerciseSettings,
  ExercisePhase,
} from '../contracts/engine';
import {
  GLOVE_FINGERS,
  pullFromClosure,
  closureFromPull,
} from '../contracts/glove';
import type { FingerId } from '../contracts/vision';
import { POSES, MAX_ASSIST_PULL, opensFinger } from '../contracts/poses';
import type { PoseDef, PoseId } from '../contracts/poses';
import { THERAPY_LIMITS } from '../contracts/therapist';
import type { ProgressionStart } from './types';
import type {
  CoachDecision,
  CoachToolName,
  FeelingEntry,
  LiveTherapyState,
  TherapyAdjustments,
  TherapyApi,
} from '../contracts/therapist';

type Source = CoachDecision['source'];
type Snapshot = Omit<
  LiveTherapyState,
  'adjustments' | 'last_feeling' | 'highlighted_finger'
>;
export interface TherapyContext {
  snapshot(): Snapshot | null;
  sessionId(): number | null;
  now(): number;
  brake(): void;
  lowerHelp(fingers: FingerId[], delayChanged: boolean): void;
  assistNow(finger: FingerId): boolean;
  revertIntensity(dispatch: boolean): void;
  sessionControl(
    tool: 'pause_session' | 'resume_session' | 'skip_pose' | 'stop_session',
  ): void;
  onDecision?(decision: CoachDecision): void;
  onFeeling?(feeling: FeelingEntry): void;
}
type IntensityKind = 'further' | 'faster' | 'hold_longer';
type Raised = Map<FingerId, Set<IntensityKind>>;
const cloneRaised = (raised: Raised): Raised =>
  new Map([...raised].map(([f, kinds]) => [f, new Set(kinds)]));
const normalizeSpeech = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
type Undo = { id: string; revert(): void };
const clamp = (n: number, low: number, high: number) =>
  Math.max(low, Math.min(high, n));
const finite = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);
const perFinger = (value: number) =>
  Object.fromEntries(GLOVE_FINGERS.map((f) => [f, value])) as Record<
    FingerId,
    number
  >;
export function shapePose(
  pose: PoseDef,
  scales: Record<FingerId, number>,
): PoseDef {
  const closure = { ...pose.closure };
  const render = { ...pose.render };
  for (const f of GLOVE_FINGERS) {
    closure[f] =
      pose.closure[f] === null
        ? null
        : opensFinger(pose, f)
          ? closureFromPull(pullFromClosure(pose.closure[f]!) * scales[f])
          : pose.closure[f]! * scales[f];
    render[f] = {
      mcp: opensFinger(pose, f)
        ? POSES.full_fist.render[f].mcp * closure[f]!
        : pose.render[f].mcp * scales[f],
      pip: opensFinger(pose, f)
        ? POSES.full_fist.render[f].pip * closure[f]!
        : pose.render[f].pip * scales[f],
      dip: opensFinger(pose, f)
        ? POSES.full_fist.render[f].dip * closure[f]!
        : pose.render[f].dip * scales[f],
    };
  }
  return { ...pose, closure, render };
}
const defaults = (): TherapyAdjustments => ({
  assist_speed: perFinger(0.2),
  assist_delay_s: perFinger(6),
  target_scale: perFinger(1),
  extra_reps: 0,
  hold_extra_s: 0,
  intensified: [],
  attempt_s: 6,
  extra_rest_s: 0,
  next_pose: null,
});

/** Pure session policy. Only the engine can turn these bounded overrides into commands. */
export class TherapyController implements TherapyApi {
  private readonly bounds = structuredClone(THERAPY_LIMITS);
  // Return copies: UI/model consumers cannot mutate the safety policy.
  get limits() {
    return structuredClone(this.bounds);
  }
  private desired = defaults();
  private active = defaults();
  private allowedPoses = new Set<PoseId>();
  private changed = new Set<string>();
  private settingsAssist = true;
  /** The glove only moves when the patient asks (engine help_on_request). */
  private onRequest = true;
  /** Help asked for outside an attempt: started by the engine at the next opening ATTEMPT. */
  private queued = new Set<FingerId>();
  private undoStack: Undo[] = [];
  private log: CoachDecision[] = [];
  private feelingLog: FeelingEntry[] = [];
  private feelingAt: number | null = null;
  private feelingTimestamp = 0;
  private restSpent = 0;
  private restBoundary = 0;
  private sequence = 0;
  private speedCap = 0.2;
  private speedCeilings = perFinger(0.2);
  private highlight: { finger: FingerId; until: number } | null = null;
  private pendingRepeats = 0;
  private repeatsSpent = 0;
  private repeatBoundary = 0;
  private pendingCanceled = new Map<FingerId, number>();
  private raised: Raised = new Map();
  private activeRaised: Raised = new Map();
  private beforeIntensity = new Map<FingerId, number>();
  private intensityPending = new Map<
    string,
    { finger: FingerId; kind: IntensityKind; at: number }
  >();
  private intensityGeneration = 0;
  private intensitySpeedCap = 0.3;
  private patientSpeech: {
    text: string;
    normalized: string;
    at: number;
    used: Set<string>;
  }[] = [];
  private painReported: number | null = null;
  private resistanceAt = new Map<FingerId, number>();
  constructor(private readonly context: TherapyContext) {}

  reset(
    plan: ExercisePlanItem[],
    settings: ExerciseSettings & { progression?: ProgressionStart },
  ) {
    this.settingsAssist = settings.assist_enabled;
    this.onRequest =
      (settings as { help_on_request?: boolean }).help_on_request !== false;
    this.desired = defaults();
    this.speedCap = Math.min(
      this.bounds.assist_speed[1],
      settings.assist_speed,
    );
    for (const finger of GLOVE_FINGERS)
      this.desired.assist_speed[finger] = this.speedCap;
    this.intensitySpeedCap = this.bounds.intensify_speed_max;
    this.raised.clear();
    this.activeRaised.clear();
    this.beforeIntensity.clear();
    this.intensityPending.clear();
    this.intensityGeneration++;
    this.patientSpeech = [];
    this.speedCeilings = perFinger(this.speedCap);
    this.desired.assist_delay_s = perFinger(
      Math.min(settings.attempt_s, this.bounds.assist_delay_s[1]),
    );
    this.desired.attempt_s = settings.attempt_s;
    this.highlight = null;
    this.pendingRepeats = 0;
    this.repeatsSpent = 0;
    this.repeatBoundary = 0;
    this.active = structuredClone(this.desired);
    this.allowedPoses = new Set(
      plan.map((p) => p.pose).filter((p) => p !== 'pinch'),
    );
    this.changed.clear();
    this.queued.clear();
    this.undoStack = [];
    this.log = [];
    this.feelingLog = [];
    this.feelingAt = null;
    this.feelingTimestamp = 0;
    this.restSpent = 0;
    this.restBoundary = 0;
    this.applyProgression(settings.progression);
  }

  /**
   * Today's plan (docs/plan/17): easier per-finger targets and more time to try alone, as the
   * starting point the coach adjusts from. Clamped here so a bad plan can never make practice
   * harder than the standard targets or leave THERAPY_LIMITS.
   */
  private applyProgression(progression: ProgressionStart | undefined) {
    if (!progression) return;
    const target_scale: Partial<Record<FingerId, number>> = {};
    let clamped = false;
    for (const f of GLOVE_FINGERS) {
      const requested = progression.target_scale[f];
      if (requested === undefined) continue;
      const value = finite(requested)
        ? clamp(requested, this.bounds.target_scale[0], 1)
        : 1;
      clamped ||= value !== requested;
      this.desired.target_scale[f] = value;
      if (value < 1) target_scale[f] = value;
    }
    const attempt_s = finite(progression.attempt_s)
      ? clamp(
          Math.max(progression.attempt_s, this.desired.attempt_s),
          this.bounds.attempt_s[0],
          this.bounds.attempt_s[1],
        )
      : this.desired.attempt_s;
    clamped ||= attempt_s !== progression.attempt_s;
    this.desired.attempt_s = attempt_s;
    this.desired.assist_delay_s = perFinger(
      Math.min(attempt_s, this.bounds.assist_delay_s[1]),
    );
    this.active = structuredClone(this.desired);
    this.decision(
      'progression_plan' as CoachToolName,
      {
        challenge: progression.challenge,
        sessions: [...progression.sessions],
        target_scale: { ...progression.target_scale },
        attempt_s: progression.attempt_s,
      },
      { target_scale, attempt_s },
      clamped ? 'clamped' : 'applied',
      progression.summary,
      'local_rule',
    );
  }

  /** Called before phase entry actions. Rest and pose overrides are consumed once. */
  boundary(phase: ExercisePhase) {
    if (phase === 'ASSIST') {
      // Undo may remove intensity here; new intensity can only start at ATTEMPT.
      for (const [finger, kinds] of this.activeRaised) {
        for (const kind of kinds)
          if (!this.raised.get(finger)?.has(kind)) kinds.delete(kind);
        if (!kinds.size) this.activeRaised.delete(finger);
      }
      for (const f of GLOVE_FINGERS)
        this.active.assist_speed[f] = Math.min(
          this.desired.assist_speed[f],
          this.activeRaised.get(f)?.has('faster')
            ? this.intensitySpeedCap
            : this.speedCeilings[f],
        );
      this.active.intensified = [...this.activeRaised.keys()];
      this.active.hold_extra_s = [...this.activeRaised.values()].some((k) =>
        k.has('hold_longer'),
      )
        ? this.desired.hold_extra_s
        : 0;
    }
    if (phase === 'ATTEMPT') {
      for (const [key, pending] of this.intensityPending) {
        if (
          this.context.now() - pending.at >
          this.bounds.consent_window_s * 1000
        ) {
          this.intensityGeneration++;
          this.removeIntensity(pending.finger, pending.kind);
          this.decision(
            'intensify',
            { finger: pending.finger, kind: pending.kind },
            { auto_reverted: true, intensified: [...this.raised.keys()] },
            'undone',
            'Patient consent expired before the next attempt.',
            'local_rule',
          );
        }
        this.intensityPending.delete(key);
      }
      this.activeRaised = cloneRaised(this.raised);
      this.active.intensified = [...this.raised.keys()];
      this.active.hold_extra_s = this.desired.hold_extra_s;
      this.active.attempt_s = this.desired.attempt_s;
      this.active.assist_delay_s = { ...this.desired.assist_delay_s };
      this.active.target_scale = { ...this.desired.target_scale };
      this.active.assist_speed = { ...this.desired.assist_speed };
    }
    if (phase === 'REST') {
      this.restBoundary++;
      this.active.extra_rest_s = this.desired.extra_rest_s;
      this.desired.extra_rest_s = 0;
    }
    if (phase === 'PRESENT') {
      this.active.next_pose = this.desired.next_pose;
      this.desired.next_pose = null;
    }
    return structuredClone(this.active);
  }
  current() {
    return structuredClone(this.active);
  }
  notePatientSpeech(text: string, t = this.context.now()): void {
    const now = this.context.now();
    if (
      typeof text !== 'string' ||
      !text.trim() ||
      !Number.isFinite(t) ||
      t > now ||
      now - t > this.bounds.consent_window_s * 1000
    )
      return;
    // Consent belongs to the latest patient turn; an old yes cannot override a new no.
    this.patientSpeech = [];
    const normalized = normalizeSpeech(text);
    if (
      /^(no\b(?! (problem|pain|discomfort|tingling|fatigue|dolor)\b| me duele\b)|stop|pause|cancel|don t|do not|not now|basta|para)\b|\b(don t want|do not want|no quiero|please stop)\b/.test(
        normalized,
      )
    ) {
      this.revertIntensity('Patient withdrew consent for intensity.');
      return;
    }
    this.patientSpeech.push({
      text,
      normalized: normalizeSpeech(text),
      at: t,
      used: new Set(),
    });
    if (this.patientSpeech.length > 50) this.patientSpeech.shift();
  }
  private removeIntensity(finger: FingerId, kind: IntensityKind) {
    this.raised.get(finger)?.delete(kind);
    if (!this.raised.get(finger)?.size) this.raised.delete(finger);
    if (kind === 'faster')
      this.desired.assist_speed[finger] = Math.min(
        this.beforeIntensity.get(finger) ?? this.speedCap,
        this.speedCeilings[finger],
      );
    if (![...this.raised.values()].some((k) => k.has('hold_longer')))
      this.desired.hold_extra_s = 0;
    this.desired.intensified = [...this.raised.keys()];
  }
  private revertIntensity(reason: string, dispatch = true) {
    this.patientSpeech = [];
    if (!this.raised.size && !this.activeRaised.size) return;
    const fingers = [
      ...new Set([...this.raised.keys(), ...this.activeRaised.keys()]),
    ];
    const wasActive = this.activeRaised.size > 0;
    for (const f of fingers) {
      const speed = Math.min(
        this.beforeIntensity.get(f) ?? this.speedCap,
        this.speedCeilings[f],
      );
      this.desired.assist_speed[f] = Math.min(
        this.desired.assist_speed[f],
        speed,
      );
      this.active.assist_speed[f] = Math.min(
        this.active.assist_speed[f],
        speed,
      );
    }
    this.raised.clear();
    this.activeRaised.clear();
    this.intensityPending.clear();
    this.beforeIntensity.clear();
    this.desired.intensified = [];
    this.active.intensified = [];
    this.desired.hold_extra_s = 0;
    this.active.hold_extra_s = 0;
    this.intensityGeneration++;
    if (wasActive) this.context.revertIntensity(dispatch);
    this.decision(
      'intensify',
      { reason },
      { fingers, intensified: [], auto_reverted: true },
      'undone',
      reason,
      'local_rule',
    );
  }
  pose(base: PoseDef): PoseDef {
    const pose = shapePose(base, this.active.target_scale);
    for (const [finger, kinds] of this.activeRaised) {
      if (
        kinds.has('further') &&
        opensFinger(base, finger) &&
        base.closure[finger] !== null
      ) {
        pose.closure[finger] = closureFromPull(
          this.bounds.intensify_target_max,
        );
        pose.render[finger] = { ...POSES.open.render[finger] };
      }
    }
    return pose;
  }
  targetCap(finger: FingerId) {
    return this.activeRaised.get(finger)?.has('further')
      ? this.bounds.intensify_target_max
      : MAX_ASSIST_PULL;
  }
  holdSeconds(base: number) {
    return base + this.active.hold_extra_s;
  }
  attemptSeconds() {
    return this.active.attempt_s;
  }
  speed(finger: FingerId) {
    return this.active.assist_speed[finger];
  }
  delay(finger: FingerId) {
    return this.active.assist_delay_s[finger];
  }
  /** The patient's latest turn (within the consent window) asks for help or says yes. */
  private patientAskedForHelp(): boolean {
    const now = this.context.now();
    return this.patientSpeech.some(
      (line) =>
        now >= line.at &&
        now - line.at <= this.bounds.consent_window_s * 1000 &&
        !/\b(no|not|don t|stop|para|basta|no quiero)\b/.test(line.normalized) &&
        (/\b(help|ayuda|ayudame|ayudar|ayudes|assist)\b/.test(
          line.normalized,
        ) ||
          /^(yes|yeah|yep|sure|please|si|dale|bueno|ok|okay|por favor)\b/.test(
            line.normalized,
          )),
    );
  }
  /** Fingers waiting for help at the next opening attempt. */
  queuedHelp(): FingerId[] {
    return [...this.queued];
  }
  consumeQueuedHelp(finger: FingerId) {
    this.queued.delete(finger);
  }
  takeCanceled(index: number): FingerId[] {
    const fingers = [...this.pendingCanceled]
      .filter(([, attempt]) => attempt === index)
      .map(([finger]) => finger);
    this.pendingCanceled.clear();
    return fingers;
  }
  takeRepeats() {
    const count = this.pendingRepeats;
    this.pendingRepeats = 0;
    this.repeatBoundary++;
    return count;
  }
  safety(source: string, finger: FingerId | null) {
    if (source === 'overcurrent' && finger)
      this.resistanceAt.set(finger, this.context.now());
    this.revertIntensity(
      `Safety stop (${source}); returned to gentle practice.`,
      false,
    );
  }
  resistance(finger: FingerId) {
    this.resistanceAt.set(finger, this.context.now());
    this.revertIntensity(
      'Resistance detected; returned to gentle practice.',
      false,
    );
    const speed = Math.max(
      Math.min(this.bounds.assist_speed[0], this.speedCap),
      Math.round(
        (Math.min(
          this.speedCeilings[finger],
          this.active.assist_speed[finger],
          this.desired.assist_speed[finger],
        ) -
          this.bounds.assist_step) *
          100,
      ) / 100,
    );
    this.speedCeilings[finger] = speed;
    this.desired.assist_speed[finger] = Math.min(
      this.desired.assist_speed[finger],
      speed,
    );
    this.active.assist_speed[finger] = Math.min(
      this.active.assist_speed[finger],
      speed,
    );
    this.decision(
      'adjust_help',
      { finger, direction: 'gentler', reason: 'Resistance detected.' },
      { finger, assist_speed: speed, automatic: true },
      'applied',
      'Resistance detected; future help will stay gentler.',
      'local_rule',
    );
  }
  state(): LiveTherapyState | null {
    const snapshot = this.context.snapshot();
    if (!snapshot) return null;
    const feeling = this.feelingLog.at(-1);
    return structuredClone({
      ...snapshot,
      adjustments: this.desired,
      highlighted_finger:
        this.highlight && this.context.now() < this.highlight.until
          ? this.highlight.finger
          : null,
      last_feeling: feeling
        ? {
            pain: feeling.pain,
            fatigue: feeling.fatigue,
            minutes_ago: Math.max(
              0,
              (this.context.now() - this.feelingAt!) / 60_000,
            ),
          }
        : null,
    });
  }
  decisions() {
    return structuredClone(
      this.log.map((d) => ({
        ...d,
        session_id: d.session_id ?? this.context.sessionId(),
      })),
    );
  }
  feelings() {
    return structuredClone(
      this.feelingLog.map((f) => ({
        ...f,
        session_id: f.session_id || this.context.sessionId() || 0,
      })),
    );
  }
  private listeners = new Set<(d: CoachDecision) => void>();
  onDecision(cb: (d: CoachDecision) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  private decision(
    tool: CoachToolName,
    requested: Record<string, unknown>,
    applied: Record<string, unknown> | null,
    result: CoachDecision['result'],
    reason: string,
    source: Source,
    revert?: () => void,
  ) {
    const decision: CoachDecision = {
      id: `therapy-${Date.now()}-${++this.sequence}`,
      t: new Date().toISOString(),
      session_id: this.context.sessionId(),
      tool,
      requested: structuredClone(requested),
      applied: applied === null ? null : structuredClone(applied),
      result,
      reason,
      source,
    };
    this.log.push(decision);
    if (revert) this.undoStack.push({ id: decision.id, revert });
    // Audit/UI observers cannot interrupt braking or the engine's safety actions.
    try {
      this.context.onDecision?.(structuredClone(decision));
    } catch {
      /* Retained in the session audit. */
    }
    for (const cb of this.listeners) {
      try {
        cb(structuredClone(decision));
      } catch {
        /* One observer cannot suppress the others. */
      }
    }
    return structuredClone(decision);
  }
  private running() {
    const state = this.context.snapshot();
    return state && state.phase !== 'DONE' && state.phase !== 'PAUSED'
      ? state
      : null;
  }
  brake(reason: string, source: Source): CoachDecision {
    return this.applyBrake(reason, source, { reason });
  }
  private applyBrake(
    reason: string,
    source: Source,
    requested: Record<string, unknown>,
  ): CoachDecision {
    // Release precedes audit listeners or network work, even outside a running session.
    this.context.brake();
    this.queued.clear(); // a brake never leaves motion waiting for later
    this.revertIntensity('Braking cleared patient-requested intensity.', false);
    return this.decision(
      'brake',
      requested,
      { phase: 'PAUSED', safety_source: 'coach_brake' },
      'applied',
      reason,
      source,
    );
  }
  recordFeeling(
    f: Omit<FeelingEntry, 't' | 'session_id' | 'attempt_index'>,
  ): CoachDecision {
    return this.adjust(
      'record_feeling',
      f,
      f.source === 'ui' ? 'patient_ui' : 'coach',
    );
  }
  undo(): CoachDecision | null {
    if (!this.undoStack.length) return null;
    return this.adjust('undo_last_adjustment', {}, 'patient_ui');
  }
  adjust(
    tool: CoachToolName,
    args: Record<string, unknown>,
    source: Source,
  ): CoachDecision {
    const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
    const reject = (why: string) =>
      this.decision(tool, args, null, 'rejected', why, source);
    if (tool === 'brake')
      return this.applyBrake(
        reason || 'The assistant requested a brake.',
        source,
        args,
      );
    if (tool === 'get_live_state')
      return this.decision(
        tool,
        args,
        this.state() as unknown as Record<string, unknown> | null,
        'applied',
        'Live session state.',
        source,
      );

    if (tool === 'record_feeling') {
      if (finite(args.pain) && args.pain >= this.bounds.intensify_pain_block)
        this.painReported = Math.max(this.painReported ?? 0, args.pain);
      if (
        finite(args.pain) &&
        args.pain > 0 &&
        args.pain < this.bounds.pain_brake_at
      )
        this.revertIntensity('Pain reported; returned to gentle practice.');
      // A valid high pain value must brake even if the remaining payload is malformed.
      if (finite(args.pain) && args.pain >= this.bounds.pain_brake_at)
        this.brake('Reported pain is at least 4 out of 10.', 'local_rule');
      const snapshot = this.context.snapshot();
      if (!snapshot || snapshot.phase === 'DONE')
        return reject('No exercise session is running.');
      if (
        !finite(args.pain) ||
        !finite(args.fatigue) ||
        args.pain < 0 ||
        args.pain > 10 ||
        args.fatigue < 0 ||
        args.fatigue > 10 ||
        typeof args.note !== 'string'
      )
        return reject(
          'Pain and fatigue must be numbers from 0 to 10, with a text note.',
        );
      this.painReported = args.pain;
      // A3 identifies a feeling by (session_id, t), including retried uploads.
      this.feelingTimestamp = Math.max(Date.now(), this.feelingTimestamp + 1);
      const feeling: FeelingEntry = {
        t: new Date(this.feelingTimestamp).toISOString(),
        session_id: this.context.sessionId() ?? 0,
        attempt_index: snapshot.index,
        pain: args.pain,
        fatigue: args.fatigue,
        note: args.note,
        source: source === 'patient_ui' ? 'ui' : 'voice',
      };
      this.feelingLog.push(feeling);
      this.feelingAt = this.context.now();
      try {
        this.context.onFeeling?.(structuredClone(feeling));
      } catch {
        /* Retained in the session feeling log. */
      }
      return this.decision(
        tool,
        args,
        { ...feeling },
        'applied',
        'Recorded how your hand feels.',
        source,
      );
    }
    const snapshot = this.context.snapshot();
    if (['get_progress', 'repeat_instruction'].includes(tool)) {
      if (!snapshot) return reject('No exercise session is running.');
      return this.decision(
        tool,
        args,
        tool === 'get_progress'
          ? {
              index: snapshot.index,
              total: snapshot.total,
              last_attempt: snapshot.last_attempt,
            }
          : { instruction: POSES[snapshot.pose].instruction },
        'applied',
        'Current session information.',
        source,
      );
    }
    if (
      ['pause_session', 'resume_session', 'skip_pose', 'stop_session'].includes(
        tool,
      )
    ) {
      if (!snapshot || snapshot.phase === 'DONE')
        return reject('No exercise session is running.');
      if (tool === 'resume_session' && snapshot.phase !== 'PAUSED')
        return reject('The session is not paused.');
      const decision = this.decision(
        tool,
        args,
        { action: tool },
        'applied',
        reason || 'Session control requested.',
        source,
      );
      this.context.sessionControl(
        tool as
          'pause_session' | 'resume_session' | 'skip_pose' | 'stop_session',
      );
      return decision;
    }
    if (tool === 'highlight_finger' || tool === 'note_for_therapist') {
      if (!snapshot || snapshot.phase === 'DONE')
        return reject('No exercise session is running.');
      if (tool === 'highlight_finger') {
        if (!GLOVE_FINGERS.includes(args.finger as FingerId))
          return reject('Unknown finger.');
        this.highlight = {
          finger: args.finger as FingerId,
          until: this.context.now() + 4000,
        };
        return this.decision(
          tool,
          args,
          { finger: args.finger, seconds: 4 },
          'applied',
          'Highlighted the finger.',
          source,
        );
      }
      if (typeof args.text !== 'string' || !args.text.trim())
        return reject('Give a text note for the therapist.');
      return this.decision(
        tool,
        args,
        { text: args.text.trim() },
        'applied',
        'Saved a note for your therapist.',
        source,
      );
    }
    const state = this.running();
    if (!state)
      return reject(
        'No exercise session is running, or the session is paused.',
      );
    if (tool === 'undo_last_adjustment') {
      const undo = this.undoStack.pop();
      if (!undo) return reject('There is no adjustment to undo.');
      undo.revert();
      return this.decision(
        tool,
        args,
        {
          decision_id: undo.id,
          ...structuredClone(this.desired),
          applies: 'next boundary',
        },
        'undone',
        'The last adjustment will be reverted at the next boundary.',
        source,
      );
    }
    if (!reason && tool !== 'intensify')
      return reject('Give a plain-language reason for the adjustment.');
    let applied: Record<string, unknown>;
    let revert: () => void;
    let clamped = false;
    switch (tool) {
      case 'intensify': {
        if (!GLOVE_FINGERS.includes(args.finger as FingerId))
          return reject('Unknown finger.');
        const finger = args.finger as FingerId;
        if (!['further', 'hold_longer', 'faster'].includes(args.kind as string))
          return reject('Unknown intensity kind.');
        const kind = args.kind as IntensityKind;
        if (
          args.consent !== 'patient_asked' &&
          args.consent !== 'accepted_offer'
        )
          return reject('Patient consent is required.');
        if (
          typeof args.patient_quote !== 'string' ||
          !args.patient_quote.trim()
        )
          return reject('Quote the patient consent.');
        const quote = normalizeSpeech(args.patient_quote);
        const now = this.context.now();
        const speech = [...this.patientSpeech]
          .reverse()
          .find(
            (line) =>
              line.normalized === quote &&
              now >= line.at &&
              now - line.at <= this.bounds.consent_window_s * 1000,
          );
        if (!speech)
          return reject(
            'No matching patient utterance was reported in the last 20 seconds.',
          );
        if (
          /\b(no|not|don t|can t|stop|pain|hurt|hurts|duele|basta|para)\b/.test(
            quote,
          )
        )
          return reject('The patient utterance does not give clear consent.');
        const consentWords =
          args.consent === 'accepted_offer'
            ? /^(yes|yeah|yep|okay|ok|sure|agreed|si|adelante)\b|^(sounds good|go ahead|please do)\b/
            : kind === 'faster'
              ? /\b(faster|quicker|rapido|rapida)\b/
              : kind === 'hold_longer'
                ? /\b(longer|hold|tiempo|manten)\b/
                : /\b(open|wider|stretch|straighten|abrir|abri|estirar)\b/;
        if (!consentWords.test(quote))
          return reject(
            'Ask the patient for a clear request or yes before raising intensity.',
          );
        if (
          this.painReported !== null &&
          this.painReported >= this.bounds.intensify_pain_block
        )
          return reject('Intensity is blocked by reported pain of at least 2.');
        const resistance = this.resistanceAt.get(finger);
        if (
          resistance !== undefined &&
          now - resistance < this.bounds.intensify_cooldown_s * 1000
        )
          return reject('This finger had resistance in the last 60 seconds.');
        if (this.changed.has(`${state.index}:${finger}`))
          return reject('Change each finger only once per attempt.');
        if (
          this.raised.get(finger)?.has(kind) ||
          speech.used.has(`${finger}:${kind}`)
        )
          return reject('That requested intensity is already applied.');
        const target = state.fingers.find((f) => f.finger === finger)?.target;
        if (
          target === null ||
          target === undefined ||
          (kind === 'further' && !opensFinger(POSES[state.pose], finger))
        )
          return reject('The glove can only help this finger open.');
        const previousRaised = cloneRaised(this.raised);
        const previousPending = new Map(this.intensityPending);
        const previousSpeed = this.desired.assist_speed[finger];
        const previousHold = this.desired.hold_extra_s;
        const generation = this.intensityGeneration;
        if (kind === 'faster') this.beforeIntensity.set(finger, previousSpeed);
        const kinds = this.raised.get(finger) ?? new Set<IntensityKind>();
        kinds.add(kind);
        this.raised.set(finger, kinds);
        this.intensityPending.set(`${finger}:${kind}`, {
          finger,
          kind,
          at: speech.at,
        });
        if (kind === 'faster') {
          this.desired.assist_speed[finger] = this.intensitySpeedCap;
          clamped = this.intensitySpeedCap <= previousSpeed;
        }
        if (kind === 'hold_longer')
          this.desired.hold_extra_s = this.bounds.hold_add_max_s;
        this.desired.intensified = [...this.raised.keys()];
        this.changed.add(`${state.index}:${finger}`);
        speech.used.add(`${finger}:${kind}`);
        applied = {
          finger,
          kind,
          consent: args.consent,
          patient_quote: args.patient_quote,
          assist_speed: this.desired.assist_speed[finger],
          target_max:
            kind === 'further' ? this.bounds.intensify_target_max : null,
          hold_extra_s: this.desired.hold_extra_s,
          intensified: [...this.raised.keys()],
          applies: 'next ATTEMPT',
        };
        revert = () => {
          if (generation !== this.intensityGeneration) return;
          this.raised = cloneRaised(previousRaised);
          this.intensityPending = new Map(previousPending);
          this.desired.assist_speed[finger] = Math.min(
            previousSpeed,
            this.speedCeilings[finger],
          );
          this.desired.hold_extra_s = previousHold;
          this.desired.intensified = [...this.raised.keys()];
        };
        break;
      }
      case 'adjust_help': {
        if (
          args.finger !== 'all' &&
          !GLOVE_FINGERS.includes(args.finger as FingerId)
        )
          return reject('Unknown finger.');
        if (!['more', 'less', 'gentler'].includes(args.direction as string))
          return reject('Direction must be more, less or gentler.');
        const fingers =
          args.finger === 'all' ? GLOVE_FINGERS : [args.finger as FingerId];
        if (fingers.some((f) => this.changed.has(`${state.index}:${f}`)))
          return reject('Change each finger only once per attempt.');
        const previousSpeed = { ...this.desired.assist_speed };
        const previousDelay = { ...this.desired.assist_delay_s };
        for (const f of fingers) {
          if (args.direction === 'gentler') {
            if (this.raised.get(f)?.has('faster')) {
              this.removeIntensity(f, 'faster');
              this.intensityPending.delete(`${f}:faster`);
              this.activeRaised.get(f)?.delete('faster');
              if (!this.activeRaised.get(f)?.size) this.activeRaised.delete(f);
              this.active.intensified = [...this.activeRaised.keys()];
            }
            const requested =
              Math.round(
                (Math.min(previousSpeed[f], this.desired.assist_speed[f]) -
                  this.bounds.assist_step) *
                  100,
              ) / 100;
            const speed = clamp(
              requested,
              Math.min(this.bounds.assist_speed[0], this.speedCap),
              this.speedCeilings[f],
            );
            clamped ||= speed !== requested;
            this.desired.assist_speed[f] = speed;
            this.active.assist_speed[f] = Math.min(
              this.active.assist_speed[f],
              speed,
            );
          } else {
            const requested =
              previousDelay[f] + (args.direction === 'more' ? -1 : 1);
            const delay = clamp(requested, ...this.bounds.assist_delay_s);
            clamped ||= delay !== requested;
            this.desired.assist_delay_s[f] = delay;
            if (args.direction === 'less')
              this.active.assist_delay_s[f] = Math.max(
                this.active.assist_delay_s[f],
                delay,
              );
          }
          this.changed.add(`${state.index}:${f}`);
        }
        if (args.direction !== 'more')
          this.context.lowerHelp(fingers, args.direction === 'less');
        applied = {
          assist_speed: { ...this.desired.assist_speed },
          assist_delay_s: { ...this.desired.assist_delay_s },
          applies: args.direction === 'more' ? 'next ATTEMPT' : 'immediately',
        };
        revert = () => {
          for (const f of fingers) {
            this.desired.assist_speed[f] = Math.min(
              previousSpeed[f],
              this.speedCeilings[f],
            );
            this.desired.assist_delay_s[f] = previousDelay[f];
          }
        };
        break;
      }
      case 'assist_finger_now': {
        if (!GLOVE_FINGERS.includes(args.finger as FingerId))
          return reject('Unknown finger.');
        const finger = args.finger as FingerId;
        if (state.phase === 'ASSIST' || state.phase === 'ASSIST_HOLD') {
          // The patient already asked and the glove is helping: add the finger now,
          // never queue more motion for a later attempt.
          if (this.changed.has(`${state.index}:${finger}`))
            return reject('Change each finger only once per attempt.');
          if (!this.context.assistNow(finger))
            return reject(
              'The glove is already helping in this attempt; this finger needs no more help now.',
            );
          this.changed.add(`${state.index}:${finger}`);
          return this.decision(
            tool,
            args,
            { finger, applies: 'now, within the power stagger' },
            'applied',
            reason,
            source,
          );
        }
        if (state.phase !== 'ATTEMPT') {
          // Asked between attempts: start it at the next opening attempt, so the
          // request always has a real effect the coach can truthfully describe.
          if (!this.settingsAssist)
            return reject('Assistance is off for this session.');
          if (this.onRequest && !this.patientAskedForHelp())
            return reject(
              'The glove moves only when the patient asks. Ask them first; set help after they ask or say yes.',
            );
          if (this.queued.has(finger))
            return reject(
              'Help for this finger is already set for the next attempt.',
            );
          this.queued.add(finger);
          return this.decision(
            tool,
            args,
            { finger, applies: 'next opening ATTEMPT' },
            'applied',
            reason,
            source,
            () => {
              this.queued.delete(finger);
            },
          );
        }
        if (this.changed.has(`${state.index}:${finger}`))
          return reject('Change each finger only once per attempt.');
        if (!this.context.assistNow(finger))
          return reject(
            'Help requires enabled assistance, a visible hand, safe glove telemetry and a finger that needs help opening.',
          );
        this.changed.add(`${state.index}:${finger}`);
        return this.decision(
          tool,
          args,
          { finger, applies: 'now, within the power stagger' },
          'applied',
          reason,
          source,
          () => {
            if (this.context.snapshot()?.index === state.index)
              this.pendingCanceled.set(finger, state.index);
          },
        );
      }
      case 'adjust_target': {
        if (!GLOVE_FINGERS.includes(args.finger as FingerId))
          return reject('Unknown finger.');
        const finger = args.finger as FingerId;
        if (state.fingers.find((f) => f.finger === finger)?.target === null)
          return reject('This finger is free in the current pose.');
        if (args.direction !== 'lower' && args.direction !== 'raise')
          return reject('Direction must be lower or raise.');
        if (this.changed.has(`${state.index}:${finger}`))
          return reject('Change each finger only once per attempt.');
        const previous = this.desired.target_scale[finger];
        const requested =
          Math.round(
            (previous +
              (args.direction === 'lower' ? -1 : 1) * this.bounds.target_step) *
              100,
          ) / 100;
        const scale = clamp(requested, ...this.bounds.target_scale);
        clamped = scale !== requested;
        this.desired.target_scale[finger] = scale;
        this.changed.add(`${state.index}:${finger}`);
        applied = { finger, target_scale: scale, applies: 'next ATTEMPT' };
        revert = () => {
          this.desired.target_scale[finger] = previous;
        };
        break;
      }
      case 'repeat_pose': {
        if (this.repeatsSpent >= 3)
          return reject('The session already has three extra repetitions.');
        this.repeatsSpent++;
        this.pendingRepeats++;
        this.desired.extra_reps++;
        const boundary = this.repeatBoundary;
        applied = {
          extra_reps: this.desired.extra_reps,
          applies: 'after this attempt',
        };
        revert = () => {
          if (boundary === this.repeatBoundary && this.pendingRepeats > 0) {
            this.pendingRepeats--;
            this.desired.extra_reps--;
          }
        };
        break;
      }
      case 'set_attempt_time': {
        if (!finite(args.seconds))
          return reject('Attempt time must be a finite number.');
        const seconds = clamp(args.seconds, ...this.bounds.attempt_s);
        clamped = seconds !== args.seconds;
        const previous = this.desired.attempt_s;
        const previousDelays = { ...this.desired.assist_delay_s };
        for (const f of GLOVE_FINGERS)
          if (this.desired.assist_delay_s[f] === previous)
            this.desired.assist_delay_s[f] = clamp(
              seconds,
              ...this.bounds.assist_delay_s,
            );
        this.desired.attempt_s = seconds;
        applied = { seconds, applies: 'next ATTEMPT' };
        revert = () => {
          this.desired.attempt_s = previous;
          this.desired.assist_delay_s = previousDelays;
        };
        break;
      }
      case 'add_rest': {
        if (!finite(args.seconds) || args.seconds <= 0)
          return reject('Extra rest must be a positive finite number.');
        const seconds = Math.min(
          args.seconds,
          this.bounds.rest_add_max_s,
          this.bounds.rest_total_max_s - this.restSpent,
        );
        if (seconds <= 0)
          return reject('The session extra-rest limit has been reached.');
        clamped = seconds !== args.seconds;
        this.restSpent += seconds;
        this.desired.extra_rest_s += seconds;
        applied = {
          seconds,
          extra_rest_s: this.desired.extra_rest_s,
          applies: 'next REST',
        };
        // Consumed rest cannot be undone or refunded into a fresh budget.
        const restBoundary = this.restBoundary;
        revert = () => {
          if (this.restBoundary === restBoundary)
            this.desired.extra_rest_s = Math.max(
              0,
              this.desired.extra_rest_s - seconds,
            );
        };
        break;
      }
      case 'choose_next_pose': {
        if (!this.allowedPoses.has(args.pose as PoseId))
          return reject('Choose a non-pinch pose from this session plan.');
        if (state.index + 1 >= state.total)
          return reject('There is no next pose in the plan.');
        const previous = this.desired.next_pose;
        this.desired.next_pose = args.pose as PoseId;
        applied = { pose: args.pose, applies: 'next PRESENT' };
        revert = () => {
          this.desired.next_pose = previous;
        };
        break;
      }
      default:
        return reject('Unknown therapy tool.');
    }
    return this.decision(
      tool,
      args,
      applied,
      clamped ? 'clamped' : 'applied',
      reason || 'Patient requested this intensity.',
      source,
      revert,
    );
  }
}
