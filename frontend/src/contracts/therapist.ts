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
  | 'undo_last_adjustment'
  | 'assist_finger_now'
  | 'adjust_target'
  | 'highlight_finger'
  | 'note_for_therapist'
  | 'repeat_pose'
  | 'intensify'
  | 'pause_session'
  | 'resume_session'
  | 'skip_pose'
  | 'repeat_instruction'
  | 'stop_session'
  | 'get_progress';

export interface TherapyLimits {
  /** Assist speed is a gentleness control only: it never goes above the default. */
  assist_speed: [number, number]; // range per second, [0.10, 0.20]
  assist_speed_default: number; // 0.20
  assist_step: number; // 0.05
  /** "More help" = help starts sooner: per-finger wait before assisting, seconds. */
  assist_delay_s: [number, number]; // [1, 9] (default = attempt_s)
  /** Shaping: per-finger target as a fraction of the pose target. */
  target_scale: [number, number]; // [0.5, 1.0]
  target_step: number; // 0.1
  attempt_s: [number, number]; // [4, 9]
  /**
   * Patient-requested intensity (owner decision): only after the patient asked, or said yes to the
   * coach's offer, within consent_window_s; blocked by pain >= intensify_pain_block or a resistance
   * event on that finger in the last intensify_cooldown_s; reverted automatically if either appears.
   */
  intensify_speed_max: number; // 0.30 /s (normal practice speed)
  intensify_target_max: number; // 1.0 = the calibrated comfortable "closed"
  hold_add_max_s: number; // 2
  consent_window_s: number; // 20
  intensify_pain_block: number; // 2
  intensify_cooldown_s: number; // 60
  rest_add_max_s: number; // 20
  rest_total_max_s: number; // 60
  pain_brake_at: number; // 4
}

export const THERAPY_LIMITS: TherapyLimits = {
  assist_speed: [0.1, 0.2],
  assist_speed_default: 0.2,
  assist_step: 0.05,
  assist_delay_s: [1, 9],
  target_scale: [0.5, 1],
  target_step: 0.1,
  attempt_s: [4, 9],
  intensify_speed_max: 0.3,
  intensify_target_max: 1,
  hold_add_max_s: 2,
  consent_window_s: 20,
  intensify_pain_block: 2,
  intensify_cooldown_s: 60,
  rest_add_max_s: 20,
  rest_total_max_s: 60,
  pain_brake_at: 4,
};

export interface TherapyAdjustments {
  assist_speed: Record<FingerId, number>;
  /** Seconds into the attempt before the glove starts helping this finger. */
  assist_delay_s: Record<FingerId, number>;
  /** Shaping: fraction of the pose target required for this finger. */
  target_scale: Record<FingerId, number>;
  extra_reps: number;
  /** Seconds added to the hold by an accepted intensify(hold_longer). */
  hold_extra_s: number;
  /** Fingers whose intensity was raised at the patient's request (reverted on pain/resistance). */
  intensified: FingerId[];
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
  /** Finger currently highlighted on the virtual hand by the coach (cleared after ~4 s). */
  highlighted_finger: FingerId | null;
  glove: {
    state: 'idle' | 'run' | 'calib' | 'fault' | 'disconnected';
    current_ma: number | null;
    simulated: boolean;
  };
  last_safety: {
    source: string;
    finger: FingerId | null;
    seconds_ago: number;
  } | null;
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

/** Arguments of the intensify tool. The runtime rejects it without a fresh patient consent. */
export interface IntensifyArgs {
  finger: FingerId;
  kind: 'further' | 'hold_longer' | 'faster';
  consent: 'patient_asked' | 'accepted_offer';
  /** The patient's own words, quoted, for the audit log. */
  patient_quote: string;
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
  /** Voice layer reports each transcribed patient utterance; consent for intensify must be this fresh. */
  notePatientSpeech(text: string, t?: number): void;
  decisions(): CoachDecision[];
  feelings(): FeelingEntry[];
  onDecision(cb: (d: CoachDecision) => void): Unsubscribe;
}
