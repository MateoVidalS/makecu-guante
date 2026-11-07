import type {
  ExercisePlanItem,
  ExerciseSettings,
  ExercisePhase,
} from '../contracts/engine';
import { GLOVE_FINGERS } from '../contracts/glove';
import type { FingerId } from '../contracts/vision';
import type { PoseId } from '../contracts/poses';
import { THERAPY_LIMITS } from '../contracts/therapist';
import type {
  CoachDecision,
  CoachToolName,
  FeelingEntry,
  LiveTherapyState,
  TherapyAdjustments,
  TherapyApi,
} from '../contracts/therapist';

type Source = CoachDecision['source'];
type Snapshot = Omit<LiveTherapyState, 'adjustments' | 'last_feeling'>;
export interface TherapyContext {
  snapshot(): Snapshot | null;
  sessionId(): number | null;
  now(): number;
  brake(): void;
  lowerHelp(speeds: Record<FingerId, number>): void;
  onDecision?(decision: CoachDecision): void;
  onFeeling?(feeling: FeelingEntry): void;
}
type Undo = { id: string; revert(): void };
const clamp = (n: number, low: number, high: number) =>
  Math.max(low, Math.min(high, n));
const finite = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);
const defaults = (): TherapyAdjustments => ({
  assist_speed: { thumb: 0.3, index: 0.3, middle: 0.3, ring: 0.3, pinky: 0.3 },
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
  private undoStack: Undo[] = [];
  private log: CoachDecision[] = [];
  private feelingLog: FeelingEntry[] = [];
  private feelingAt: number | null = null;
  private restSpent = 0;
  private restBoundary = 0;
  private sequence = 0;
  private speedCap = 0.3;
  constructor(private readonly context: TherapyContext) {}

  reset(plan: ExercisePlanItem[], settings: ExerciseSettings) {
    this.desired = defaults();
    this.speedCap = Math.min(
      this.bounds.assist_speed[1],
      settings.assist_speed,
    );
    for (const finger of GLOVE_FINGERS)
      this.desired.assist_speed[finger] = this.speedCap;
    this.desired.attempt_s = settings.attempt_s;
    this.active = structuredClone(this.desired);
    this.allowedPoses = new Set(
      plan.map((p) => p.pose).filter((p) => p !== 'pinch'),
    );
    this.changed.clear();
    this.undoStack = [];
    this.log = [];
    this.feelingLog = [];
    this.feelingAt = null;
    this.restSpent = 0;
    this.restBoundary = 0;
  }

  /** Called before phase entry actions. Rest and pose overrides are consumed once. */
  boundary(phase: ExercisePhase) {
    if (phase === 'ASSIST')
      this.active.assist_speed = { ...this.desired.assist_speed };
    if (phase === 'ATTEMPT') this.active.attempt_s = this.desired.attempt_s;
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
  state(): LiveTherapyState | null {
    const snapshot = this.context.snapshot();
    if (!snapshot) return null;
    const feeling = this.feelingLog.at(-1);
    return structuredClone({
      ...snapshot,
      adjustments: this.desired,
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
    this.context.onDecision?.(structuredClone(decision));
    for (const cb of this.listeners) cb(structuredClone(decision));
    return structuredClone(decision);
  }
  private running() {
    const state = this.context.snapshot();
    return state && state.phase !== 'DONE' && state.phase !== 'PAUSED'
      ? state
      : null;
  }
  brake(reason: string, source: Source): CoachDecision {
    // Release precedes audit listeners or network work, even outside a running session.
    this.context.brake();
    return this.decision(
      'brake',
      { reason },
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
      return this.brake(reason || 'The assistant requested a brake.', source);
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
      const feeling: FeelingEntry = {
        t: new Date().toISOString(),
        session_id: this.context.sessionId() ?? 0,
        attempt_index: snapshot.index,
        pain: args.pain,
        fatigue: args.fatigue,
        note: args.note,
        source: source === 'patient_ui' ? 'ui' : 'voice',
      };
      this.feelingLog.push(feeling);
      this.feelingAt = this.context.now();
      this.context.onFeeling?.(structuredClone(feeling));
      return this.decision(
        tool,
        args,
        { ...feeling },
        'applied',
        'Recorded how your hand feels.',
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
    if (!reason)
      return reject('Give a plain-language reason for the adjustment.');
    let applied: Record<string, unknown>;
    let revert: () => void;
    let clamped = false;
    switch (tool) {
      case 'adjust_help': {
        if (
          args.finger !== 'all' &&
          !GLOVE_FINGERS.includes(args.finger as FingerId)
        )
          return reject('Unknown finger.');
        if (args.direction !== 'more' && args.direction !== 'less')
          return reject('Direction must be more or less.');
        const fingers =
          args.finger === 'all' ? GLOVE_FINGERS : [args.finger as FingerId];
        if (fingers.some((f) => this.changed.has(`${state.index}:${f}`)))
          return reject('Help can change only once per finger per attempt.');
        const previous = { ...this.desired.assist_speed };
        for (const f of fingers) {
          const requested =
            Math.round(
              (previous[f] +
                (args.direction === 'more' ? 1 : -1) *
                  this.bounds.assist_step) *
                100,
            ) / 100;
          const speed = clamp(
            requested,
            Math.min(this.bounds.assist_speed[0], this.speedCap),
            this.speedCap,
          );
          this.desired.assist_speed[f] = speed;
          clamped ||= speed !== requested;
          this.changed.add(`${state.index}:${f}`);
          if (args.direction === 'less')
            this.active.assist_speed[f] = Math.min(
              this.active.assist_speed[f],
              speed,
            );
        }
        if (args.direction === 'less')
          this.context.lowerHelp({ ...this.active.assist_speed });
        applied = {
          assist_speed: { ...this.desired.assist_speed },
          applies: args.direction === 'less' ? 'immediately' : 'next ASSIST',
        };
        revert = () => {
          for (const f of fingers) this.desired.assist_speed[f] = previous[f];
        };
        break;
      }
      case 'set_attempt_time': {
        if (!finite(args.seconds))
          return reject('Attempt time must be a finite number.');
        const seconds = clamp(args.seconds, ...this.bounds.attempt_s);
        clamped = seconds !== args.seconds;
        const previous = this.desired.attempt_s;
        this.desired.attempt_s = seconds;
        applied = { seconds, applies: 'next ATTEMPT' };
        revert = () => {
          this.desired.attempt_s = previous;
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
      reason,
      source,
      revert,
    );
  }
}
