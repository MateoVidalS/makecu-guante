import type { GloveFinger, Quint } from './glove';
import type { FingerId } from './vision';
import type { PoseId } from './poses';

// ---------- session engine (src/contracts/engine.ts) ----------
export type ExercisePhase =
  | 'PRESENT'
  | 'ATTEMPT'
  | 'HOLD'
  | 'ASSIST'
  | 'ASSIST_HOLD'
  | 'RELEASE'
  | 'PAUSED'
  | 'REST'
  | 'DONE';
export interface ExercisePlanItem {
  pose: PoseId;
  reps: number;
}
export interface ExerciseSettings {
  present_s: number;
  attempt_s: number;
  hold_s: number;
  assist_max_s: number;
  rest_s: number; // 3, 6, 2, 6, 3
  tolerance: number; // 0.10 closure
  reach_dwell_s: number; // 0.5
  assist_speed: number; // 0.3 /s of pull (opening)
  plateau_s: number; // 2.0 (no gain > 0.03 → end the attempt early, after at least 3 s)
  assist_enabled: boolean; // false = observation only (no glove)
}
export type EngineEvent =
  | {
      kind: 'phase';
      phase: ExercisePhase;
      pose: PoseId;
      rep: number;
      index: number;
    } // index = attempt index in the session
  | { kind: 'reached'; t_rel: number; assisted: boolean }
  | { kind: 'progress'; finger: GloveFinger; active_max: number } // throttled to at most 2 Hz per finger
  | { kind: 'assist_started'; fingers: GloveFinger[]; from: Quint; to: Quint } // closure units (vision), not pull; the glove only opens
  | { kind: 'resistance'; finger: GloveFinger; ma: number } // current high + finger not following
  | { kind: 'help_offered'; fingers: GloveFinger[] } // not reached alone; the glove waits for the patient to ask
  | {
      kind: 'safety';
      source:
        | 'overcurrent'
        | 'stop_button'
        | 'watchdog'
        | 'camera_lost'
        | 'glove_disconnected'
        | 'coach_brake';
      finger: GloveFinger | null;
      ma: number | null;
    }
  | { kind: 'attempt_done'; result: AttemptResult }
  | { kind: 'session_done'; summary: SessionSummary };

export interface FingerAttemptMetrics {
  finger: FingerId;
  scored: boolean;
  target: number | null;
  active_max: number | null; // max vision closure during ATTEMPT (for an "open" target: the min, i.e. best opening)
  assist_needed: number | null; // opening glove (docs/plan/15): opening deficit the glove could assist, max(0, active_min − target) beyond tolerance; null/0 for closing targets (never assisted)
  final: number | null; // vision closure at the end of the hold
}
export interface AttemptResult {
  pose: PoseId;
  rep: number;
  index: number;
  started_at: string;
  ended_at: string;
  reached_active: boolean; // reached without help
  reached_final: boolean; // reached by the end (active or assisted)
  assisted: boolean;
  time_to_position_s: number | null; // from ATTEMPT start to the active reach; null if not reached actively
  active_ratio: number; // mean over scored fingers of clamp(active_max / target) (for open: 1 − active_min); 0..1
  fingers: FingerAttemptMetrics[];
  pinch_min: number | null;
  current_peak_ma: number | null;
  current_mean_ma: number | null; // during ASSIST
  safety_events: {
    source: string;
    t_rel: number;
    finger: GloveFinger | null;
    ma: number | null;
  }[];
  interrupted: boolean;
  trace: AttemptTrace;
}
export interface AttemptTrace {
  // 20 Hz
  hz: 20;
  t: number[]; // seconds from attempt start
  closure: Record<GloveFinger, (number | null)[]>; // vision
  servo: Record<GloveFinger, number[]>; // telemetry a
  ma: number[];
  phase: ExercisePhase[];
}
export interface SessionSummary {
  attempts: number;
  reached_active: number;
  assisted: number;
  interrupted: number;
  active_ratio_mean: number;
  per_pose: {
    pose: PoseId;
    active_ratio_mean: number;
    assisted: number;
    reps: number;
  }[];
  per_finger: {
    finger: GloveFinger;
    active_max_mean: number | null;
    assist_needed_mean: number | null;
  }[];
  previous: {
    active_ratio_mean: number;
    per_finger: { finger: GloveFinger; active_max_mean: number | null }[];
  } | null;
}
