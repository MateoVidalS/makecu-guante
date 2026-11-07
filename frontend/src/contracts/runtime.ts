import type { GloveFinger } from './glove';
import type { Calibration, FrictionCurve } from './calibration';
import type { PoseDef } from './poses';
import type {
  ExercisePhase,
  ExercisePlanItem,
  ExerciseSettings,
  AttemptResult,
  SessionSummary,
  EngineEvent,
} from './engine';
import type { EvaluationResult, EvalSettings } from './evaluation';

//

export type Unsubscribe = () => void;
export interface ExerciseView {
  phase: ExercisePhase;
  pose: PoseDef;
  rep: number;
  index: number;
  total: number;
  phaseElapsed: number;
  phaseDuration: number | null;
  activeMax: Partial<Record<GloveFinger, number>>;
  assisting: boolean;
  paused: boolean;
  sessionId: number | null;
  lastResult: AttemptResult | null;
  summary: SessionSummary | null;
}
export interface EvaluationView {
  stage: 'idle' | 'prepare' | 'sweep' | 'cooldown' | 'done' | 'aborted';
  finger: GloveFinger | null;
  speed: 'slow' | 'fast' | null;
  progress: number;
  result: EvaluationResult | null;
}
export interface Runtime {
  sources: {
    glove: 'serial' | 'sim';
    vision: 'camera' | 'sim';
    setGlove(k: 'serial' | 'sim'): Promise<void>;
    setVision(k: 'camera' | 'sim'): Promise<void>;
  };
  calibration: {
    current: Calibration | null;
    reload(): Promise<void>;
    save(c: Omit<Calibration, 'id' | 'created_at'>): Promise<Calibration>;
    sendToGlove(): Promise<void>;
  }; // sends the 3 calib + limit messages
  exercise: {
    start(plan: ExercisePlanItem[], settings: ExerciseSettings): Promise<void>;
    pause(): void;
    resume(): void;
    skip(): void;
    stop(): Promise<void>;
    view(): ExerciseView;
    subscribe(cb: (v: ExerciseView) => void): Unsubscribe;
    onEvent(cb: (e: EngineEvent) => void): Unsubscribe;
  };
  evaluation: {
    start(settings: EvalSettings): Promise<void>;
    stop(): Promise<void>;
    view(): EvaluationView;
    subscribe(cb: (v: EvaluationView) => void): Unsubscribe;
    runFriction(
      fingers: GloveFinger[],
    ): Promise<Partial<Record<GloveFinger, FrictionCurve[]>>>;
  }; // wizard step 3
}
// React: <RuntimeProvider> + useRuntime(), useExerciseView(selector), useEvaluationView(selector), useGlove() (WP2), useVision() (WP3).
// useVision(): { source: VisionSource; latest: VisionFrame | null; subscribe(selector) }
