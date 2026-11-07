// AI therapy assistant contract (docs/plan/13-ai-therapist.md §3–4).
import type { ExercisePhase } from './engine';
import type { PoseId } from './poses';
import type { Unsubscribe } from './runtime';
import type { FingerId } from './vision';

export type CoachToolName =
  | 'get_live_state'
  | 'adjust_help'
  | 'set_attempt_time'
  | 'add_rest'
  | 'choose_next_pose'
  | 'record_feeling'
  | 'brake'
  | 'undo_last_adjustment';

export interface TherapyLimits {
  assist_speed: [number, number]; // range per second, [0.10, 0.30]
  assist_step: number; // 0.05
  attempt_s: [number, number]; // [4, 9]
  rest_add_max_s: number; // 20
  rest_total_max_s: number; // 60
  pain_brake_at: number; // 4
}

export const THERAPY_LIMITS: TherapyLimits = {
  assist_speed: [0.1, 0.3],
  assist_step: 0.05,
  attempt_s: [4, 9],
  rest_add_max_s: 20,
  rest_total_max_s: 60,
  pain_brake_at: 4,
};

export interface TherapyAdjustments {
  assist_speed: Record<FingerId, number>;
  attempt_s: number;
  extra_rest_s: number;
  next_pose: PoseId | null;
}

export interface LiveTherapyFinger {
  finger: FingerId;
  now: number | null;
  target: number | null;
  best_alone: number | null;
  glove_helping: boolean;
  lagging: boolean;
}

export interface LiveTherapyState {
  phase: ExercisePhase;
  pose: PoseId;
  rep: number;
  index: number;
  total: number;
  seconds_in_phase: number;
  fingers: LiveTherapyFinger[];
  last_attempt: {
    reached_alone: boolean;
    assisted: boolean;
    active_ratio: number;
  } | null;
  adjustments: TherapyAdjustments;
  last_feeling: { pain: number; fatigue: number; minutes_ago: number } | null;
}

export interface CoachDecision {
  id: string;
  t: string;
  session_id: number | null;
  tool: CoachToolName | string;
  requested: Record<string, unknown>;
  applied: Record<string, unknown> | null;
  result: 'applied' | 'clamped' | 'rejected' | 'undone';
  reason: string;
  source: 'coach' | 'local_rule' | 'patient_ui';
}

export interface FeelingEntry {
  t: string;
  session_id: number;
  attempt_index: number | null;
  pain: number;
  fatigue: number;
  note: string;
  source: 'voice' | 'ui';
}

export interface TherapyApi {
  readonly limits: TherapyLimits;
  state(): LiveTherapyState | null;
  adjust(
    tool: CoachToolName,
    args: Record<string, unknown>,
    source: CoachDecision['source'],
  ): CoachDecision;
  undo(): CoachDecision | null;
  brake(reason: string, source: CoachDecision['source']): CoachDecision;
  recordFeeling(
    f: Omit<FeelingEntry, 't' | 'session_id' | 'attempt_index'>,
  ): CoachDecision;
  decisions(): CoachDecision[];
  feelings(): FeelingEntry[];
  onDecision(cb: (d: CoachDecision) => void): Unsubscribe;
}
