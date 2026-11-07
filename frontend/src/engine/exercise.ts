import type { Calibration } from '../contracts/calibration';
import type {
  AttemptResult,
  EngineEvent,
  ExercisePhase,
  ExercisePlanItem,
  ExerciseSettings,
} from '../contracts/engine';
import { GLOVE_FINGERS } from '../contracts/glove';
import type { GloveFinger, Triple } from '../contracts/glove';
import { calibratedPinch, POSES } from '../contracts/poses';
import type { PoseDef, PoseId } from '../contracts/poses';
import type {
  EngineInput,
  EngineOptions,
  ExerciseEngine,
  Output,
} from './types';
import { closure, motorSafe, output, visible } from './input';
import { AttemptMetrics, isoTime, summarizeSession } from './metrics';

type Safety = Extract<EngineEvent, { kind: 'safety' }>;
type Gap = { now: number; gaps: Triple };

class Exercise implements ExerciseEngine {
  private phase: ExercisePhase = 'DONE';
  private phaseAt = 0;
  private now = 0;
  private plan: { pose: PoseId; rep: number }[] = [];
  private index = 0;
  private settings!: ExerciseSettings;
  private calibration!: Calibration;
  private input: EngineInput | null = null;
  private metrics: AttemptMetrics | null = null;
  private results: AttemptResult[] = [];
  private visibleAt: number | null = null;
  private lowAt: number | null = null;
  private releasedForVision = false;
  private dwellAt: number | null = null;
  private settledAt: number | null = null;
  private repromptAt = 0;
  private lastFollow: number | null = null;
  private progress = new Map<GloveFinger, { at: number; value: number }>();
  private plateau: {
    now: number;
    best: Partial<Record<GloveFinger, number>>;
  }[] = [];
  private gaps: Gap[] = [];
  private target: Triple = [0, 0, 0];
  private targetVision: Triple = [0, 0, 0];
  private targetSent = false;
  private baseline: number[] = [];
  private baselineTel: number | null = null;
  private high: { at: number; finger: GloveFinger; closure: number } | null =
    null;
  private resistance = false;
  constructor(private readonly options: EngineOptions) {}

  private get pose(): PoseDef {
    const id = this.plan[this.index]?.pose ?? this.plan.at(-1)?.pose ?? 'open';
    return id === 'pinch' && this.calibration
      ? calibratedPinch(this.calibration.camera.pinch_closed)
      : POSES[id];
  }
  private get rep(): number {
    return this.plan[this.index]?.rep ?? this.plan.at(-1)?.rep ?? 1;
  }

  /** 06-session §3 PRESENT row: begin released, with no motion until a visible hand. */
  start(
    plan: ExercisePlanItem[],
    settings: ExerciseSettings,
    calibration: Calibration,
    now: number,
  ): Output {
    for (const [key, value] of Object.entries(settings)) {
      if (typeof value === 'number' && (!Number.isFinite(value) || value < 0))
        throw new Error(`Invalid exercise setting: ${key}`);
    }
    if (settings.assist_speed <= 0)
      throw new Error('assist_speed must be positive');
    this.settings = { ...settings };
    this.calibration = calibration;
    this.plan = plan.flatMap((item) => {
      if (!Number.isInteger(item.reps) || item.reps < 1)
        throw new Error('reps must be a positive integer');
      return Array.from({ length: item.reps }, (_, i) => ({
        pose: item.pose,
        rep: i + 1,
      }));
    });
    this.now = now;
    this.index = 0;
    this.results = [];
    this.metrics = null;
    this.input = null;
    this.gaps = [];
    this.progress.clear();
    this.lastFollow = null;
    const out = output();
    if (this.plan.length) this.enter('PRESENT', out);
    else {
      out.commands.push({ t: 'release' });
      this.finish(out);
    }
    return out;
  }

  /** 06-session §3 phase table: all automatic transitions use only the supplied clock. */
  tick(input: EngineInput): Output {
    this.now = input.now;
    this.input = input;
    const out = output();
    if (this.phase === 'DONE') return out;
    this.metrics?.observe(input, this.phase);
    this.rememberGaps(input);
    if (this.phase !== 'PAUSED') {
      const event = input.gloveEvents.find(
        (e) =>
          e.e === 'overcurrent' || e.e === 'stop_button' || e.e === 'watchdog',
      );
      if (event) {
        this.safety(
          {
            kind: 'safety',
            source: event.e as Safety['source'],
            finger: event.e === 'overcurrent' ? this.attribute() : null,
            ma: event.ma ?? input.tel?.ma ?? null,
          },
          out,
        );
        return out;
      }
      if (!input.gloveConnected) {
        this.safety(
          {
            kind: 'safety',
            source: 'glove_disconnected',
            finger: null,
            ma: null,
          },
          out,
        );
        return out;
      }
      // A fault telemetry frame can arrive before its event. Do not invent a cause.
      if (input.tel?.st === 'fault') {
        this.interrupt(out);
        return out;
      }
    }
    if (this.phase === 'PAUSED') return out;
    if (!this.visionGate(out)) return out;
    const elapsed = (this.now - this.phaseAt) / 1000;
    switch (this.phase) {
      case 'PRESENT':
        if (visible(input)) this.visibleAt ??= this.now;
        else this.visibleAt = null;
        if (
          elapsed >= this.settings.present_s &&
          this.visibleAt !== null &&
          this.now - this.visibleAt >= 500
        ) {
          this.enter('ATTEMPT', out);
          this.follow(out);
        } else if (this.now - this.repromptAt >= 8000) {
          this.repromptAt = this.now;
          this.phaseEvent(out);
        }
        break;
      case 'ATTEMPT':
        this.follow(out);
        this.reportProgress(out);
        if (this.reachedDwell()) {
          this.metrics!.reachedActive = true;
          this.metrics!.reachedFinal = true;
          this.metrics!.timeToPosition =
            (this.dwellAt! - this.metrics!.start) / 1000;
          out.events.push({
            kind: 'reached',
            assisted: false,
            t_rel: this.metrics!.timeToPosition,
          });
          this.enter('HOLD', out);
        } else if (elapsed >= this.settings.attempt_s || this.isPlateau()) {
          this.enter(this.settings.assist_enabled ? 'ASSIST' : 'RELEASE', out);
        }
        break;
      case 'HOLD':
        this.follow(out);
        if (elapsed >= this.settings.hold_s) this.enter('RELEASE', out);
        break;
      case 'ASSIST':
        this.assist(out);
        break;
      case 'ASSIST_HOLD':
        if (elapsed >= this.settings.hold_s) this.enter('RELEASE', out);
        break;
      case 'RELEASE':
        if (elapsed >= 0.5) {
          this.record(out);
          this.enter('REST', out);
        }
        break;
      case 'REST':
        if (elapsed >= this.settings.rest_s) this.next(out);
        break;
    }
    return out;
  }

  /** 06-session §3 PAUSED row: manual pause releases and requires explicit resume. */
  pause(now: number): Output {
    this.now = now;
    const out = output();
    if (this.phase !== 'DONE' && this.phase !== 'PAUSED') this.interrupt(out);
    return out;
  }

  /** 06-session §3 PAUSED row: release clears firmware fault before recording/rest. */
  resume(now: number): Output {
    this.now = now;
    const out = output();
    if (this.phase === 'PAUSED') this.enter('RELEASE', out);
    return out;
  }

  /** 06-session §6 skip mid-attempt: release and preserve an interrupted result. */
  skip(now: number): Output {
    this.now = now;
    const out = output();
    if (this.phase === 'DONE') return out;
    if (this.metrics) {
      this.metrics.interrupted = true;
      this.enter('RELEASE', out);
    } else {
      out.commands.push({ t: 'release' });
      this.next(out);
    }
    return out;
  }

  /** 06-session §6 stop mid-attempt: release, preserve partial data, finish once. */
  stop(now: number): Output {
    this.now = now;
    const out = output();
    if (this.phase === 'DONE') return out;
    out.commands.push({ t: 'release' });
    if (this.metrics) {
      this.metrics.interrupted = true;
      this.record(out);
    }
    this.finish(out);
    return out;
  }

  state(): ReturnType<ExerciseEngine['state']> {
    return {
      phase: this.phase,
      pose: this.pose.id,
      rep: this.rep,
      index: this.index,
      total: this.plan.length,
      phaseElapsed: (this.now - this.phaseAt) / 1000,
    };
  }

  /** 06-session §3 entry actions: PRESENT/RELEASE/PAUSED release; ASSIST targets once. */
  private enter(phase: ExercisePhase, out: Output): void {
    const continuingAssist = this.phase === 'ASSIST' && phase === 'ASSIST_HOLD';
    this.phase = phase;
    this.phaseAt = this.now;
    this.dwellAt = null;
    this.settledAt = null;
    if (!continuingAssist) {
      this.lowAt = null;
      this.releasedForVision = false;
    }
    this.phaseEvent(out);
    if (phase === 'PRESENT' || phase === 'RELEASE' || phase === 'PAUSED')
      out.commands.push({ t: 'release' });
    if (phase === 'PRESENT') {
      this.visibleAt = null;
      this.repromptAt = this.now;
      this.lastFollow = null;
    }
    if (phase === 'ATTEMPT') {
      this.metrics = new AttemptMetrics(
        this.pose,
        this.rep,
        this.index,
        this.now,
        this.options.timestamp ?? isoTime,
      );
      this.metrics.observe(this.input!, phase);
      this.progress.clear();
      this.plateau = [{ now: this.now, best: { ...this.metrics.best } }];
      this.gaps = [];
      this.reachedDwell();
    }
    if (phase === 'ASSIST') {
      this.metrics!.assisted = true;
      this.baseline = [];
      this.baselineTel = null;
      this.high = null;
      this.resistance = false;
      this.targetSent = false;
      this.updateTarget();
      out.events.push({
        kind: 'assist_started',
        fingers: GLOVE_FINGERS.filter(
          (f, i) =>
            this.pose.closure[f] !== null &&
            this.target[i] !== closure(this.input!)[i],
        ),
        from: closure(this.input!),
        to: [...this.target],
      });
      this.sendTarget(out);
      this.collectBaseline();
    }
    if (this.input)
      this.metrics?.trace.sample({ ...this.input, now: this.now }, phase);
  }
  private phaseEvent(out: Output): void {
    out.events.push({
      kind: 'phase',
      phase: this.phase,
      pose: this.pose.id,
      rep: this.rep,
      index: this.index,
    });
  }

  /** 06-session §3 REST row: advance one planned repetition after the rest interval. */
  private next(out: Output): void {
    if (this.index + 1 < this.plan.length) {
      this.index++;
      this.enter('PRESENT', out);
    } else this.finish(out);
  }

  /** 06-session §4: emit the complete session summary once, after the last attempt. */
  private finish(out: Output): void {
    this.enter('DONE', out);
    out.events.push({
      kind: 'session_done',
      summary: summarizeSession(this.results),
    });
  }
  private record(out: Output): void {
    if (!this.metrics) return;
    if (this.input)
      this.metrics.trace.sample({ ...this.input, now: this.now }, this.phase);
    const result = this.metrics.finish(this.now);
    this.results.push(result);
    out.events.push({ kind: 'attempt_done', result });
    this.metrics = null;
  }

  /** 06-session §3 safety mapping: any active phase releases immediately and latches PAUSED. */
  private safety(event: Safety, out: Output): void {
    out.events.push(event);
    this.metrics?.safety.push({
      source: event.source,
      t_rel: (this.now - this.metrics.start) / 1000,
      finger: event.finger,
      ma: event.ma,
    });
    this.interrupt(out);
  }

  /** 06-session §3 PAUSED row: all interruptions retain partial attempt metrics. */
  private interrupt(out: Output): void {
    if (this.metrics) this.metrics.interrupted = true;
    this.enter('PAUSED', out);
  }

  /** 06-session §3 vision gating: stop motion at 300 ms unseen; pause at one second. */
  private visionGate(out: Output): boolean {
    if (visible(this.input!)) {
      if (this.releasedForVision) {
        this.safety(
          { kind: 'safety', source: 'camera_lost', finger: null, ma: null },
          out,
        );
        return false;
      }
      this.lowAt = null;
      return true;
    }
    this.dwellAt = null;
    if (this.phase !== 'ASSIST' && this.phase !== 'ASSIST_HOLD') return true;
    this.lowAt ??= this.now;
    // Acceptance forbids target at low confidence, so release instead of a freeze target.
    if (!this.releasedForVision && this.now - this.lowAt >= 300) {
      out.commands.push({ t: 'release' });
      this.releasedForVision = true;
      this.targetSent = false;
    }
    if (this.now - this.lowAt >= 1000) {
      this.safety(
        { kind: 'safety', source: 'camera_lost', finger: null, ma: null },
        out,
      );
      return false;
    }
    return true;
  }

  private follow(out: Output): void {
    if (motorSafe(this.input!) && this.input!.vision!.t !== this.lastFollow) {
      out.commands.push({ t: 'follow', f: closure(this.input!) });
      this.lastFollow = this.input!.vision!.t;
    }
  }
  private fingerReached(f: GloveFinger): boolean {
    const target = this.pose.closure[f];
    const value = this.input!.vision?.closure?.[f];
    return (
      target === null ||
      (value !== undefined &&
        (this.pose.id === 'open'
          ? value <= target + this.settings.tolerance
          : value >= target - this.settings.tolerance))
    );
  }
  private reachedDwell(): boolean {
    if (
      !visible(this.input!) ||
      !GLOVE_FINGERS.every((f) => this.fingerReached(f)) ||
      (this.pose.pinch &&
        (this.input!.vision!.pinch === null ||
          this.input!.vision!.pinch! > this.pose.pinch.max_ratio))
    ) {
      this.dwellAt = null;
      return false;
    }
    this.dwellAt ??= this.now;
    return this.now - this.dwellAt >= this.settings.reach_dwell_s * 1000;
  }
  private reportProgress(out: Output): void {
    for (const f of GLOVE_FINGERS) {
      const value = this.metrics!.best[f];
      const last = this.progress.get(f);
      if (
        value !== undefined &&
        (!last || (this.now - last.at >= 500 && value !== last.value))
      ) {
        out.events.push({ kind: 'progress', finger: f, active_max: value });
        this.progress.set(f, { at: this.now, value });
      }
    }
  }
  private isPlateau(): boolean {
    const cutoff = this.now - this.settings.plateau_s * 1000;
    this.plateau.push({ now: this.now, best: { ...this.metrics!.best } });
    while (this.plateau.length > 1 && this.plateau[1].now <= cutoff)
      this.plateau.shift();
    if (this.now - this.metrics!.start < 3000 || this.plateau[0].now > cutoff)
      return false;
    return GLOVE_FINGERS.every((f) => {
      const best = this.metrics!.best[f],
        prior = this.plateau[0].best[f];
      if (best === undefined || prior === undefined) return true;
      return (this.pose.id === 'open' ? prior - best : best - prior) <= 0.03;
    });
  }
  private updateTarget(): void {
    this.targetVision = closure(this.input!);
    this.target = GLOVE_FINGERS.map((f, i) =>
      this.pose.closure[f] === null
        ? (this.input!.tel?.a[i] ?? this.targetVision[i])
        : this.fingerReached(f)
          ? this.targetVision[i]
          : this.pose.closure[f]!,
    ) as Triple;
    this.targetSent = false;
    this.settledAt = null;
  }
  private sendTarget(out: Output): void {
    if (motorSafe(this.input!) && !this.targetSent) {
      out.commands.push({
        t: 'target',
        f: [...this.target],
        v: this.settings.assist_speed,
      });
      this.targetSent = true;
    }
  }

  /** 06-session §3 ASSIST row: reach, settle, time cap, or resistance ends assistance. */
  private assist(out: Output): void {
    const input = this.input!;
    const elapsed = this.now - this.phaseAt;
    this.collectBaseline();
    if (this.detectResistance(out)) return;
    if (this.reachedDwell()) {
      this.metrics!.reachedFinal = true;
      out.events.push({
        kind: 'reached',
        assisted: true,
        t_rel: (this.dwellAt! - this.metrics!.start) / 1000,
      });
      this.enter('ASSIST_HOLD', out);
      return;
    }
    if (
      visible(input) &&
      closure(input).some((v, i) => Math.abs(v - this.targetVision[i]) > 0.1)
    )
      this.updateTarget();
    this.sendTarget(out);
    if (
      this.targetSent &&
      input.tel &&
      input.tel.a.every((v, i) => Math.abs(v - this.target[i]) <= 0.02)
    )
      this.settledAt ??= this.now;
    else this.settledAt = null;
    if (
      (this.settledAt !== null && this.now - this.settledAt >= 1000) ||
      elapsed >= this.settings.assist_max_s * 1000
    )
      this.enter('ASSIST_HOLD', out);
  }
  private collectBaseline(): void {
    const tel = this.input!.tel;
    if (this.now - this.phaseAt <= 300 && tel && tel.t !== this.baselineTel) {
      this.baseline.push(tel.ma);
      this.baselineTel = tel.t;
    }
  }
  private rememberGaps(input: EngineInput): void {
    this.gaps = this.gaps.filter((g) => this.now - g.now <= 300);
    if (visible(input) && input.tel)
      this.gaps.push({
        now: this.now,
        gaps: GLOVE_FINGERS.map(
          (f, i) => input.tel!.a[i] - input.vision!.closure![f],
        ) as Triple,
      });
  }
  private attribute(): GloveFinger | null {
    let gap = 0;
    let finger: GloveFinger | null = null;
    for (const sample of this.gaps)
      sample.gaps.forEach((value, i) => {
        if (value > gap) {
          gap = value;
          finger = GLOVE_FINGERS[i];
        }
      });
    return finger;
  }

  /** 06-session §3 Resistance row: high current plus stalled vision freezes before hard cut. */
  private detectResistance(out: Output): boolean {
    const tel = this.input!.tel;
    if (
      this.resistance ||
      !visible(this.input!) ||
      !tel ||
      this.now - this.phaseAt <= 300 ||
      !this.baseline.length
    )
      return false;
    const sorted = [...this.baseline].sort((a, b) => a - b);
    const baseline =
      (sorted[Math.floor((sorted.length - 1) / 2)] +
        sorted[Math.floor(sorted.length / 2)]) /
      2;
    const finger = this.attribute();
    if (tel.ma <= baseline + 250 || !finger) {
      this.high = null;
      return false;
    }
    if (!this.high || this.high.finger !== finger)
      this.high = {
        at: this.now,
        finger,
        closure: this.input!.vision!.closure![finger],
      };
    if (this.input!.vision!.closure![finger] - this.high.closure > 0.02) {
      this.high = {
        at: this.now,
        finger,
        closure: this.input!.vision!.closure![finger],
      };
      return false;
    }
    if (this.now - this.high.at <= 200) return false;
    this.resistance = true;
    out.events.push({ kind: 'resistance', finger, ma: tel.ma });
    this.metrics!.safety.push({
      source: 'resistance',
      t_rel: (this.now - this.metrics!.start) / 1000,
      finger,
      ma: tel.ma,
    });
    this.target = [...tel.a];
    this.targetSent = false;
    this.sendTarget(out);
    this.enter('ASSIST_HOLD', out);
    return true;
  }
}

export function createExerciseEngine(
  options: EngineOptions = {},
): ExerciseEngine {
  return new Exercise(options);
}
