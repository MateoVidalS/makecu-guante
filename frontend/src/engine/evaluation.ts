import type { Calibration, FrictionCurve } from '../contracts/calibration';
import type {
  EvalFingerResult,
  EvalSettings,
  EvalSweep,
  EvaluationResult,
} from '../contracts/evaluation';
import { GLOVE_FINGERS } from '../contracts/glove';
import type { GloveFinger, Quint } from '../contracts/glove';
import type { EvaluationView } from '../contracts/runtime';
import type {
  EngineInput,
  EngineOptions,
  EvaluationEngine,
  Output,
} from './types';
import { motorSafe, output, visible } from './input';
import { isoTime, mean } from './metrics';

/** 06-session §5.3: linear interpolation, with endpoint values outside the measured range. */
export function interpolateFriction(
  curve: FrictionCurve | undefined,
  pos: number,
): number {
  const points =
    curve?.points
      .filter((p) => Number.isFinite(p.pos) && Number.isFinite(p.ma))
      .slice()
      .sort((a, b) => a.pos - b.pos) ?? [];
  if (!points.length) return 0;
  if (pos <= points[0].pos) return points[0].ma;
  for (let i = 1; i < points.length; i++) {
    const left = points[i - 1],
      right = points[i];
    if (pos <= right.pos)
      return (
        left.ma +
        ((right.ma - left.ma) * (pos - left.pos)) / (right.pos - left.pos)
      );
  }
  return points[points.length - 1].ma;
}

function fingerResult(
  finger: GloveFinger,
  sweeps: EvalSweep[],
): EvalFingerResult {
  const own = sweeps.filter((s) => s.finger === finger);
  const resistance = (speed: EvalSweep['speed']) =>
    mean(
      own
        .filter((s) => s.speed === speed)
        .flatMap((s) =>
          s.points
            .filter((p) => p.pos >= 0.2 - 1e-9 && p.pos <= 0.9 + 1e-9)
            .map((p) => p.excess_ma),
        ),
    );
  const slow = resistance('slow'),
    fast = resistance('fast');
  const all = own.flatMap((s) => s.points.map((p) => p.excess_ma));
  return {
    finger,
    resistance_slow_ma: slow,
    resistance_fast_ma: fast,
    velocity_dependence_ma: slow === null || fast === null ? null : fast - slow,
    peak_excess_ma: all.length ? Math.max(...all) : null,
    aborted: own.some((s) => s.aborted_at !== null),
  };
}

export interface FrictionEngine extends EvaluationEngine {
  start(
    settings: EvalSettings,
    calibration: Pick<Calibration, 'friction' | 'current_limit_ma'>,
    now: number,
  ): Output;
  /** Available after successful completion; aborted sweeps never become calibration curves. */
  curves(): Partial<Record<GloveFinger, FrictionCurve[]>>;
}

class Evaluation implements FrictionEngine {
  private stage: EvaluationView['stage'] = 'idle';
  private settings!: EvalSettings;
  private calibration!: Pick<Calibration, 'friction' | 'current_limit_ma'>;
  private started = 0;
  private now = 0;
  private phaseAt = 0;
  private zeroAt: number | null = null;
  private queue: {
    finger: GloveFinger;
    speed: EvalSweep['speed'];
    v: number;
  }[] = [];
  private index = 0;
  private sweeps: EvalSweep[] = [];
  private sweep: EvalSweep | null = null;
  private curve: FrictionCurve | undefined;
  private allFriction = true;
  private lastTel: number | null = null;
  private result: EvaluationResult | null = null;
  private progress = 0;
  constructor(
    private readonly raw: boolean,
    private readonly options: EngineOptions,
  ) {}

  /** 06-session §5.1–2: lower the current limit and release before the first sweep. */
  start(
    settings: EvalSettings,
    calibration: Pick<Calibration, 'friction' | 'current_limit_ma'>,
    now: number,
  ): Output {
    if (
      ![settings.slow_v, settings.fast_v, settings.limit_ma].every(
        (v) => Number.isFinite(v) && v > 0,
      )
    )
      throw new Error('Invalid evaluation settings');
    const fingers = [...new Set(settings.fingers ?? GLOVE_FINGERS)];
    if (fingers.some((f) => !GLOVE_FINGERS.includes(f)))
      throw new Error(
        'Evaluation fingers must belong to the five-finger glove',
      );
    this.settings = { ...settings, fingers };
    this.calibration = calibration;
    this.now = now;
    this.started = now;
    this.phaseAt = now;
    this.queue = this.settings.fingers.flatMap((finger) => [
      { finger, speed: 'slow' as const, v: settings.slow_v },
      { finger, speed: 'fast' as const, v: settings.fast_v },
    ]);
    this.index = 0;
    this.sweeps = [];
    this.sweep = null;
    this.result = null;
    this.progress = 0;
    this.zeroAt = null;
    this.lastTel = null;
    this.allFriction = !this.raw;
    this.stage = 'prepare';
    const out = output();
    out.commands.push({ t: 'limit', ma: settings.limit_ma }, { t: 'release' });
    if (!this.queue.length) this.finish('done', out);
    return out;
  }

  /** 06-session §5.2: released settling, one-finger sweep, two-second cooldown. */
  tick(input: EngineInput): Output {
    this.now = input.now;
    const out = output();
    if (
      this.stage === 'idle' ||
      this.stage === 'done' ||
      this.stage === 'aborted'
    )
      return out;
    const stop = input.gloveEvents.find(
      (e) => e.e === 'stop_button' || e.e === 'watchdog',
    );
    if (!input.gloveConnected || stop) {
      out.events.push({
        kind: 'safety',
        source: stop
          ? (stop.e as 'stop_button' | 'watchdog')
          : 'glove_disconnected',
        finger: null,
        ma: stop?.ma ?? null,
      });
      this.abort(input, out);
      return out;
    }
    const overcurrent = input.gloveEvents.find((e) => e.e === 'overcurrent');
    if (overcurrent) {
      if (this.stage !== 'sweep') {
        out.events.push({
          kind: 'safety',
          source: 'overcurrent',
          finger: null,
          ma: overcurrent.ma ?? input.tel?.ma ?? null,
        });
        this.abort(input, out);
        return out;
      }
      this.point(input);
      out.events.push({
        kind: 'safety',
        source: 'overcurrent',
        finger: this.sweep!.finger,
        ma: overcurrent.ma ?? input.tel?.ma ?? null,
      });
      this.endSweep(input, true, out);
      return out;
    }
    if (input.tel?.st === 'fault') {
      if (this.stage === 'prepare' || this.stage === 'cooldown') {
        this.zeroAt = null;
        // release is the only firmware fault-clear command; never target a latched fault.
        out.commands.push({ t: 'release' });
        return out;
      }
      this.abort(input, out);
      return out;
    }
    if (this.stage === 'prepare') {
      if (input.tel && input.tel.a.every((a) => Math.abs(a) <= 0.02))
        this.zeroAt ??= this.now;
      else this.zeroAt = null;
      if (
        this.zeroAt !== null &&
        this.now - this.zeroAt >= 1000 &&
        (this.raw
          ? input.gloveConnected && input.tel?.st === 'idle'
          : motorSafe(input))
      )
        this.beginSweep(input, out);
    } else if (this.stage === 'sweep') {
      // No pause/resume exists for evaluation; losing vision aborts rather than restarting a sweep.
      if (!this.raw && !visible(input)) {
        out.events.push({
          kind: 'safety',
          source: 'camera_lost',
          finger: null,
          ma: null,
        });
        this.abort(input, out);
        return out;
      }
      this.point(input);
      if (
        input.tel &&
        input.tel.a[GLOVE_FINGERS.indexOf(this.sweep!.finger)] >= 0.98
      )
        this.endSweep(input, false, out);
    } else if (this.stage === 'cooldown' && this.now - this.phaseAt >= 2000)
      this.next(out);
    return out;
  }

  /** 06-session §5 abort: release immediately, retain partial data, restore exercise limit. */
  stop(now: number): Output {
    this.now = now;
    const out = output();
    if (
      this.stage === 'idle' ||
      this.stage === 'done' ||
      this.stage === 'aborted'
    )
      return out;
    if (this.sweep) {
      this.sweep.aborted_at = this.progress;
      this.sweeps.push(this.sweep);
      this.sweep = null;
    }
    this.finish('aborted', out);
    return out;
  }

  state(): ReturnType<EvaluationEngine['state']> {
    const item = this.queue[this.index];
    const sweepProgress =
      this.stage === 'sweep'
        ? Math.min(1, Math.max(0, this.progress))
        : this.stage === 'cooldown' ||
            (this.stage === 'aborted' && this.progress > 0)
          ? 1
          : 0;
    return {
      stage: this.stage,
      finger:
        this.stage === 'done' || this.stage === 'idle'
          ? null
          : (item?.finger ?? null),
      speed:
        this.stage === 'done' || this.stage === 'idle'
          ? null
          : (item?.speed ?? null),
      progress: this.progress,
      result: this.result,
      completedSweeps: this.sweeps.length,
      totalSweeps: this.queue.length,
      overallProgress:
        this.stage === 'done'
          ? 1
          : this.queue.length
            ? Math.min(1, (this.index + sweepProgress) / this.queue.length)
            : 0,
    };
  }

  /** 06-session §5 friction calibration: bin raw current to the nearest 0.05 position. */
  curves(): Partial<Record<GloveFinger, FrictionCurve[]>> {
    if (!this.raw || this.stage !== 'done') return {};
    const curves: Partial<Record<GloveFinger, FrictionCurve[]>> = {};
    for (const sweep of this.sweeps) {
      if (sweep.aborted_at !== null) continue;
      const bins = new Map<number, number[]>();
      for (const p of sweep.points) {
        const bin = Math.round(p.pos * 20);
        const values = bins.get(bin) ?? [];
        values.push(p.ma);
        bins.set(bin, values);
      }
      const points = [...bins]
        .sort(([a], [b]) => a - b)
        .map(([bin, values]) => ({ pos: bin / 20, ma: mean(values)! }));
      (curves[sweep.finger] ??= []).push({ v: sweep.v, points });
    }
    return curves;
  }

  /** 06-session §5.2 sweep entry: one finger closes; all others stay released. */
  private beginSweep(input: EngineInput, out: Output): void {
    const item = this.queue[this.index];
    this.stage = 'sweep';
    this.phaseAt = this.now;
    this.progress = 0;
    this.lastTel = null;
    this.curve = this.raw
      ? undefined
      : this.calibration.friction[item.finger]?.find(
          (c) => Math.abs(c.v - item.v) < 1e-6 && c.points.length > 0,
        );
    if (!this.curve) this.allFriction = false;
    this.sweep = { ...item, points: [], aborted_at: null };
    const target: Quint = [0, 0, 0, 0, 0];
    target[GLOVE_FINGERS.indexOf(item.finger)] = 1;
    out.commands.push({ t: 'target', f: target, v: item.v });
    this.point(input);
  }
  private point(input: EngineInput): void {
    if (!input.tel || !this.sweep || input.tel.t === this.lastTel) return;
    this.lastTel = input.tel.t;
    const pos = input.tel.a[GLOVE_FINGERS.indexOf(this.sweep.finger)];
    this.progress = pos;
    this.sweep.points.push({
      pos,
      ma: input.tel.ma,
      excess_ma: input.tel.ma - interpolateFriction(this.curve, pos),
    });
  }

  /** 06-session §5.2 overcurrent: retain aborted position, skip this finger's remaining speed. */
  private endSweep(input: EngineInput, aborted: boolean, out: Output): void {
    if (aborted)
      this.sweep!.aborted_at =
        input.tel?.a[GLOVE_FINGERS.indexOf(this.sweep!.finger)] ??
        this.progress;
    this.sweeps.push(this.sweep!);
    this.sweep = null;
    out.commands.push({ t: 'release' });
    this.stage = 'cooldown';
    this.phaseAt = this.now;
    if (aborted) {
      const finger = this.queue[this.index].finger;
      while (this.queue[this.index + 1]?.finger === finger) this.index++;
    }
  }

  /** 06-session §5.2 cooldown: release again, then require one second at zero. */
  private next(out: Output): void {
    this.index++;
    if (this.index >= this.queue.length) {
      this.finish('done', out);
      return;
    }
    this.stage = 'prepare';
    this.phaseAt = this.now;
    this.zeroAt = null;
    this.progress = 0;
    out.commands.push({ t: 'release' });
  }

  /** 06-session §5 abort: non-overcurrent safety failures end the evaluation. */
  private abort(input: EngineInput, out: Output): void {
    if (this.sweep) {
      this.point(input);
      this.sweep.aborted_at = this.progress;
      this.sweeps.push(this.sweep);
      this.sweep = null;
    }
    this.finish('aborted', out);
  }

  /** 06-session §5.4–5: summarize sweeps and restore the calibrated exercise limit. */
  private finish(stage: 'done' | 'aborted', out: Output): void {
    this.stage = stage;
    out.commands.push(
      { t: 'release' },
      { t: 'limit', ma: this.calibration.current_limit_ma },
    );
    const timestamp = this.options.timestamp ?? isoTime;
    this.result = {
      started_at: timestamp(this.started),
      ended_at: timestamp(this.now),
      settings: this.settings,
      sweeps: this.sweeps,
      fingers: this.settings.fingers.map((f) => fingerResult(f, this.sweeps)),
      friction_used: this.sweeps.length > 0 && this.allFriction,
    };
  }
}

export function createEvaluationEngine(
  options: EngineOptions = {},
): EvaluationEngine {
  return new Evaluation(false, options);
}

/** Same deterministic driver as evaluation; call start/tick and read curves() after done. */
export function frictionRun(options: EngineOptions = {}): FrictionEngine {
  return new Evaluation(true, options);
}
