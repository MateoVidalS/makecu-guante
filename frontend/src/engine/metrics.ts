import type { PoseDef, PoseId } from '../contracts/poses';
import type {
  AttemptResult,
  AttemptTrace,
  ExercisePhase,
  FingerAttemptMetrics,
  SessionSummary,
} from '../contracts/engine';
import { GLOVE_FINGERS } from '../contracts/glove';
import type { GloveFinger } from '../contracts/glove';
import type { FingerId } from '../contracts/vision';
import type { EngineInput } from './types';
import { visible } from './input';

export const clamp01 = (value: number): number =>
  Math.min(1, Math.max(0, value));
export const mean = (values: number[]): number | null =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
export const isoTime = (now: number): string => new Date(now).toISOString();

/** 06-session §4: 20 Hz sample-and-hold, never copying a future input backwards. */
export class TraceBuilder {
  readonly trace: AttemptTrace = {
    hz: 20,
    t: [],
    closure: { thumb: [], index: [], middle: [] },
    servo: { thumb: [], index: [], middle: [] },
    ma: [],
    phase: [],
  };
  private next: number;
  private last: { input: EngineInput; phase: ExercisePhase } | null = null;
  constructor(private readonly start: number) {
    this.next = start;
  }

  sample(input: EngineInput, phase: ExercisePhase): void {
    while (this.last && this.next < input.now)
      this.append(this.last.input, this.last.phase);
    this.last = { input, phase };
    if (this.next === input.now) this.append(input, phase);
  }

  private append(input: EngineInput, phase: ExercisePhase): void {
    this.trace.t.push((this.next - this.start) / 1000);
    for (const f of GLOVE_FINGERS) {
      this.trace.closure[f].push(
        visible(input) ? input.vision!.closure![f] : null,
      );
      this.trace.servo[f].push(input.tel?.a[GLOVE_FINGERS.indexOf(f)] ?? 0);
    }
    this.trace.ma.push(input.tel?.ma ?? 0);
    this.trace.phase.push(phase);
    this.next += 50;
  }
}

/** Collects only ATTEMPT vision for active metrics and assisted telemetry for current. */
export class AttemptMetrics {
  readonly trace: TraceBuilder;
  readonly best: Partial<Record<GloveFinger, number>> = {};
  readonly safety: AttemptResult['safety_events'] = [];
  readonly currents: number[] = [];
  pinchMin: number | null = null;
  reachedActive = false;
  reachedFinal = false;
  assisted = false;
  interrupted = false;
  timeToPosition: number | null = null;
  private final: Partial<Record<FingerId, number>> = {};
  private lastVision: number | null = null;
  private lastTel: number | null = null;
  constructor(
    readonly pose: PoseDef,
    readonly rep: number,
    readonly index: number,
    readonly start: number,
    private readonly timestamp: (now: number) => string = isoTime,
  ) {
    this.trace = new TraceBuilder(start);
  }

  observe(input: EngineInput, phase: ExercisePhase): void {
    this.trace.sample(input, phase);
    if (visible(input) && input.vision!.t !== this.lastVision) {
      this.lastVision = input.vision!.t;
      if (phase !== 'RELEASE' && phase !== 'PAUSED')
        this.final = { ...input.vision!.closure! };
      if (phase === 'ATTEMPT') {
        for (const f of GLOVE_FINGERS) {
          if (this.pose.closure[f] === null) continue;
          const value = input.vision!.closure![f];
          this.best[f] =
            this.best[f] === undefined
              ? value
              : this.pose.id === 'open'
                ? Math.min(this.best[f]!, value)
                : Math.max(this.best[f]!, value);
        }
        if (this.pose.id === 'pinch' && input.vision!.pinch !== null) {
          this.pinchMin = Math.min(
            this.pinchMin ?? Infinity,
            input.vision!.pinch,
          );
        }
      }
    }
    if (
      (phase === 'ASSIST' || phase === 'ASSIST_HOLD') &&
      input.tel &&
      input.tel.t !== this.lastTel
    ) {
      this.lastTel = input.tel.t;
      this.currents.push(input.tel.ma);
    }
  }

  finish(now: number): AttemptResult {
    const fingers: FingerAttemptMetrics[] = (
      ['thumb', 'index', 'middle', 'ring', 'pinky'] as FingerId[]
    ).map((f) => {
      const target = this.pose.closure[f];
      const scored =
        GLOVE_FINGERS.includes(f as GloveFinger) && target !== null;
      const best = scored ? (this.best[f as GloveFinger] ?? null) : null;
      return {
        finger: f,
        scored,
        target,
        active_max: best,
        assist_needed:
          best === null || target === null
            ? null
            : Math.max(
                0,
                this.pose.id === 'open' ? best - target : target - best,
              ),
        final: this.final[f] ?? null,
      };
    });
    const ratios = fingers
      .filter((f) => f.scored)
      .map((f) =>
        f.active_max === null
          ? 0
          : clamp01(
              this.pose.id === 'open'
                ? 1 - f.active_max
                : f.active_max / f.target!,
            ),
      );
    return {
      pose: this.pose.id,
      rep: this.rep,
      index: this.index,
      started_at: this.timestamp(this.start),
      ended_at: this.timestamp(now),
      reached_active: this.reachedActive,
      reached_final: this.reachedFinal,
      assisted: this.assisted,
      time_to_position_s: this.timeToPosition,
      active_ratio: mean(ratios) ?? 0,
      fingers,
      pinch_min: this.pinchMin,
      current_peak_ma: this.currents.length ? Math.max(...this.currents) : null,
      current_mean_ma: mean(this.currents),
      safety_events: this.safety.map((e) => ({ ...e })),
      interrupted: this.interrupted,
      trace: this.trace.trace,
    };
  }
}

export function summarizeSession(attempts: AttemptResult[]): SessionSummary {
  const poses = [...new Set(attempts.map((a) => a.pose))];
  const perPose = (pose: PoseId) => {
    const group = attempts.filter((a) => a.pose === pose);
    return {
      pose,
      active_ratio_mean: mean(group.map((a) => a.active_ratio)) ?? 0,
      assisted: group.filter((a) => a.assisted).length,
      reps: group.length,
    };
  };
  return {
    attempts: attempts.length,
    reached_active: attempts.filter((a) => a.reached_active).length,
    assisted: attempts.filter((a) => a.assisted).length,
    interrupted: attempts.filter((a) => a.interrupted).length,
    active_ratio_mean: mean(attempts.map((a) => a.active_ratio)) ?? 0,
    per_pose: poses.map(perPose),
    per_finger: GLOVE_FINGERS.map((finger) => {
      const metrics = attempts.flatMap((a) =>
        a.fingers.filter((f) => f.finger === finger && f.scored),
      );
      return {
        finger,
        active_max_mean: mean(
          metrics.flatMap((f) => (f.active_max === null ? [] : [f.active_max])),
        ),
        assist_needed_mean: mean(
          metrics.flatMap((f) =>
            f.assist_needed === null ? [] : [f.assist_needed],
          ),
        ),
      };
    }),
    previous: null,
  };
}
