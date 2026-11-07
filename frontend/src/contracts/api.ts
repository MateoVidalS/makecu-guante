import type { Handedness } from './vision';
import type { GloveFinger } from './glove';
import type { PoseId } from './poses';
import type {
  ExercisePlanItem,
  ExerciseSettings,
  SessionSummary,
  AttemptResult,
} from './engine';
import type { EvaluationResult } from './evaluation';
import type { Calibration } from './calibration';
export interface Profile {
  pseudonym: string;
  affected_hand: Handedness;
  condition: string;
  goals: string;
  therapist_name: string;
  therapist_email: string;
}
export interface Session {
  id: number;
  mode: 'exercise';
  started_at: string;
  ended_at: string | null;
  calibration_id: number;
  plan: ExercisePlanItem[];
  settings: ExerciseSettings;
  is_demo: boolean;
  summary: SessionSummary | null;
  n_attempts: number;
}
export interface Attempt extends Omit<AttemptResult, 'trace'> {
  id: number;
  session_id: number;
}
export interface SessionDetail extends Session {
  attempts: Attempt[];
  transcript: TranscriptLine[];
}
export interface Evaluation extends EvaluationResult {
  id: number;
  calibration_id: number;
  is_demo: boolean;
}
export interface TranscriptLine {
  t: string;
  role: 'coach' | 'patient' | 'system';
  text: string;
}
export interface Summary {
  id: number;
  kind: 'session' | 'therapist';
  created_at: string;
  session_id: number | null;
  days: number | null;
  model: string;
  text: string;
}
export interface VoiceToken {
  token: string;
  expires_at: string;
  model: string;
  voice: string;
  system_instruction: string;
  tools: object[];
}
export interface HistoryOverview {
  sessions: number;
  attempts: number;
  evaluations: number;
  days_practiced_last_7: number;
  last_session_at: string | null;
  per_finger: {
    finger: GloveFinger;
    active_max_first: number | null;
    active_max_last: number | null;
    assist_needed_last: number | null;
  }[];
}
export interface RomPoint {
  session_id: number;
  started_at: string;
  finger: GloveFinger;
  pose: PoseId | null;
  active_max_mean: number;
  is_demo: boolean;
}
export interface AssistPoint {
  session_id: number;
  started_at: string;
  finger: GloveFinger;
  assist_needed_mean: number;
  assisted_rate: number;
  is_demo: boolean;
}
export interface ResistancePoint {
  evaluation_id: number;
  started_at: string;
  finger: GloveFinger;
  slow: number | null;
  fast: number | null;
  dependence: number | null;
  is_demo: boolean;
}
export interface Health {
  ok: boolean;
  version: string;
  gemini: boolean;
}
export interface ApiError {
  error: { code: string; message: string };
}
export type CalibrationIn = Omit<Calibration, 'id' | 'created_at'>;
export interface SessionIn {
  mode: 'exercise';
  plan: ExercisePlanItem[];
  settings: ExerciseSettings;
  calibration_id: number;
  is_demo?: boolean;
}
export type EvaluationIn = EvaluationResult & {
  calibration_id: number;
  is_demo?: boolean;
};
export type SummaryIn =
  { kind: 'session'; session_id: number } | { kind: 'therapist'; days: number };
