import {
  THERAPY_LIMITS,
  type CoachDecision,
  type CoachToolName,
  type FeelingEntry,
  type TherapyApi,
  type LiveTherapyState,
} from '../../../contracts/therapist';
import { GLOVE_FINGERS } from '../../../contracts/glove';
import type { FingerId } from '../../../contracts/vision';

export function fakeLiveState(): LiveTherapyState {
  const perFinger = (value: number) =>
    Object.fromEntries(
      GLOVE_FINGERS.map((finger) => [finger, value]),
    ) as Record<FingerId, number>;
  return {
    phase: 'ATTEMPT',
    pose: 'full_fist',
    rep: 1,
    index: 0,
    total: 3,
    seconds_in_phase: 0,
    fingers: [],
    last_attempt: null,
    adjustments: {
      assist_speed: perFinger(THERAPY_LIMITS.assist_speed_default),
      assist_delay_s: perFinger(6),
      target_scale: perFinger(1),
      extra_reps: 0,
      attempt_s: 6,
      extra_rest_s: 0,
      next_pose: null,
    },
    last_feeling: null,
    highlighted_finger: null,
    glove: { state: 'run', current_ma: 200, simulated: true },
    last_safety: null,
  };
}

/** UI test double only. It never connects to the glove or controls the engine. */
export class FakeTherapy implements TherapyApi {
  readonly limits = THERAPY_LIMITS;
  private log: CoachDecision[] = [];
  private entries: FeelingEntry[] = [];
  private listeners = new Set<(d: CoachDecision) => void>();
  brakes = 0;
  undos = 0;
  live: LiveTherapyState | null = fakeLiveState();
  state = () => this.live;
  decisions = () => this.log;
  feelings = () => this.entries;
  onDecision = (cb: (d: CoachDecision) => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };
  emit(
    tool: CoachToolName,
    args: Record<string, unknown>,
    result: CoachDecision['result'] = 'applied',
    source: CoachDecision['source'] = 'coach',
  ) {
    const decision: CoachDecision = {
      id: String(this.log.length),
      t: new Date(
        Date.UTC(2026, 10, 7, 12, 0, this.log.length * 5),
      ).toISOString(),
      session_id: 1,
      tool,
      requested: args,
      applied: result === 'rejected' ? null : args,
      result,
      reason:
        typeof args.reason === 'string' ? args.reason : 'For your comfort.',
      source,
    };
    if (
      tool === 'highlight_finger' &&
      result !== 'rejected' &&
      this.live &&
      GLOVE_FINGERS.some((finger) => finger === args.finger)
    )
      this.live.highlighted_finger = args.finger as FingerId;
    this.log.push(decision);
    this.listeners.forEach((cb) => cb(decision));
    return decision;
  }
  adjust = (
    tool: CoachToolName,
    args: Record<string, unknown>,
    source: CoachDecision['source'],
  ) => this.emit(tool, args, 'applied', source);
  undo = () => {
    this.undos++;
    return this.emit('undo_last_adjustment', {}, 'undone', 'patient_ui');
  };
  brake = (reason: string, source: CoachDecision['source']) => {
    this.brakes++;
    return this.emit('brake', { reason }, 'applied', source);
  };
  recordFeeling = (
    f: Omit<FeelingEntry, 't' | 'session_id' | 'attempt_index'>,
  ) => {
    this.entries.push({
      ...f,
      t: new Date().toISOString(),
      session_id: 1,
      attempt_index: 0,
    });
    const decision = this.emit('record_feeling', f, 'applied', 'patient_ui');
    if (f.pain >= this.limits.pain_brake_at)
      this.brake('Pain reported.', 'patient_ui');
    return decision;
  };
}
