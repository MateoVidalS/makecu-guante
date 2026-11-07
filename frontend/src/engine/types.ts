import type { VisionFrame } from '../contracts/vision';
import type { GloveTelemetry, GloveEvent, Quint } from '../contracts/glove';
import type { Calibration } from '../contracts/calibration';
import type {
  ExercisePlanItem,
  ExerciseSettings,
  EngineEvent,
} from '../contracts/engine';
import type { ExerciseView, EvaluationView } from '../contracts/runtime';
import type { EvalSettings } from '../contracts/evaluation';
export interface EngineInput {
  now: number;
  vision: VisionFrame | null;
  tel: GloveTelemetry | null;
  gloveEvents: GloveEvent[];
  gloveConnected: boolean;
}
export type GloveCommand =
  | { t: 'target'; f: Quint; v: number }
  | { t: 'follow'; f: Quint }
  | { t: 'release' }
  | { t: 'limit'; ma: number };
export interface Output {
  commands: GloveCommand[];
  events: EngineEvent[];
}
export interface ExerciseEngine {
  start(
    plan: ExercisePlanItem[],
    settings: ExerciseSettings,
    calibration: Calibration,
    now: number,
  ): Output;
  tick(input: EngineInput): Output;
  pause(now: number): Output;
  resume(now: number): Output;
  skip(now: number): Output;
  stop(now: number): Output;
  state(): {
    phase: ExerciseView['phase'];
    pose: ExerciseView['pose']['id'];
    rep: number;
    index: number;
    total: number;
    phaseElapsed: number;
  };
}
export interface EvaluationEngine {
  start(settings: EvalSettings, calibration: Calibration, now: number): Output;
  tick(input: EngineInput): Output;
  stop(now: number): Output;
  state(): EvaluationView;
}

/** Inject a monotonic-to-UTC mapping in live runtime; default interprets now as epoch ms. */
export interface EngineOptions {
  timestamp?: (now: number) => string;
}
