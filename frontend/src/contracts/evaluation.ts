import type { GloveFinger } from './glove';

// ---------- evaluation (src/contracts/evaluation.ts) ----------
export interface EvalSettings {
  slow_v: number;
  fast_v: number;
  limit_ma: number;
  fingers: GloveFinger[];
} // 0.2, 1.0, 600, all
export interface EvalSweep {
  finger: GloveFinger;
  speed: 'slow' | 'fast';
  v: number;
  points: { pos: number; ma: number; excess_ma: number }[]; // excess = ma − friction(pos, speed)
  aborted_at: number | null; // closure where overcurrent hit
}
export interface EvalFingerResult {
  finger: GloveFinger;
  resistance_slow_ma: number | null; // mean excess over pos 0.2–0.9
  resistance_fast_ma: number | null;
  velocity_dependence_ma: number | null; // fast − slow (spasticity proxy)
  peak_excess_ma: number | null;
  aborted: boolean;
}
export interface EvaluationResult {
  started_at: string;
  ended_at: string;
  settings: EvalSettings;
  sweeps: EvalSweep[];
  fingers: EvalFingerResult[];
  friction_used: boolean;
}
