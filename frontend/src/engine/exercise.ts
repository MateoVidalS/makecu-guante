import type { Calibration } from '../contracts/calibration';
import type {
  AttemptResult,
  EngineEvent,
  ExercisePhase,
  ExercisePlanItem,
} from '../contracts/engine';
import {
  GLOVE_FINGERS,
  pullFromClosure,
  closureFromPull,
} from '../contracts/glove';
import type { GloveFinger, Quint } from '../contracts/glove';
import { calibratedPinch, opensFinger, POSES } from '../contracts/poses';
import type { PoseDef, PoseId } from '../contracts/poses';
import type {
  EngineInput,
  EngineOptions,
  ExerciseEngine,
  Output,
  PowerAwareExerciseSettings,
} from './types';
import { TherapyController } from './therapy';
import type { LiveTherapyState } from '../contracts/therapist';
import { closure, motorSafe, output, visible } from './input';
import { AttemptMetrics, isoTime, summarizeSession } from './metrics';
import {
  AssistScheduler,
  DEFAULT_ASSIST_STAGGER_MS,
  MAX_ASSIST_PARALLEL,
  SERVO_PROFILES,
  heldPull,
} from './assist';

type Safety = Extract<EngineEvent, { kind: 'safety' }>;
type Gap = { now: number; gaps: Quint };

const DWELL_GAP_MS = 200;

class Exercise implements ExerciseEngine {
  private phase: ExercisePhase = 'DONE';
  private phaseAt = 0;
  private now = 0;
  private plan: { pose: PoseId; rep: number }[] = [];
  private index = 0;
  private settings!: PowerAwareExerciseSettings;
  private calibration!: Calibration;
  private input: EngineInput | null = null;
  private metrics: AttemptMetrics | null = null;
  private results: AttemptResult[] = [];
  private visibleAt: number | null = null;
  private lowAt: number | null = null;
  private releasedForVision = false;
  private dwellAt: number | null = null;
  private dwellGapAt: number | null = null;
  private dwellPausedMs = 0;
  private settledAt: number | null = null;
  private repromptAt = 0;
  private lastFollow: number | null = null;
  private progress = new Map<GloveFinger, { at: number; value: number }>();
  private plateau: {
    now: number;
    best: Partial<Record<GloveFinger, number>>;
  }[] = [];
  private gaps: Gap[] = [];
  private target: Quint = [0, 0, 0, 0, 0];
  private scheduler: AssistScheduler | null = null;
  private targetSent = false;
  private baseline: number[] = [];
  private baselineTel: number | null = null;
  private high: { at: number; finger: GloveFinger; closure: number } | null =
    null;
  private resistance = false;
  private loadHighAt: number | null = null;
  private loadBlocked = false;
  private seenSafety = new Set<string>();
  readonly therapy: TherapyController;
  private restDuration = 0;
  private currentPose: PoseDef | null = null;
  private viewPoseSource: PoseDef | null = null;
  private viewPose: PoseDef | null = null;
  private forced = new Set<GloveFinger>();
  /** Help on request: offered when time runs out, requested by the patient. */
  private helpRequested = false;
  private helpOfferedAt: number | null = null;
  private get onRequest(): boolean {
    return this.settings.help_on_request !== false;
  }
  private helped = new Set<GloveFinger>();
  private suppressed = new Set<GloveFinger>();
  private assistAt: number | null = null;
  private lastSafety: {
    source: string;
    finger: GloveFinger | null;
    at: number;
  } | null = null;
  constructor(private readonly options: EngineOptions) {
    this.therapy = new TherapyController({
      snapshot: () => this.therapySnapshot(),
      sessionId: () => options.therapy?.sessionId() ?? null,
      now: () => options.therapy?.now?.() ?? this.now,
      brake: () => {
        const out = this.brake(this.now);
        options.onTherapyOutput?.(out);
      },
      lowerHelp: (fingers, delayChanged) => {
        if (
          !this.input ||
          !['ATTEMPT', 'ASSIST', 'ASSIST_HOLD'].includes(this.phase)
        )
          return;
        if (delayChanged)
          for (const finger of fingers) {
            this.forced.delete(finger);
            if (!this.eligible(finger))
              this.scheduler?.suspend(
                GLOVE_FINGERS.indexOf(finger),
                this.input.tel?.a[GLOVE_FINGERS.indexOf(finger)] ?? 0,
              );
          }
        if (!this.scheduler || !this.metrics?.assisted) return;
        const out = output();
        this.refreshTarget();
        this.targetSent = false;
        this.sendTarget(out);
        options.onTherapyOutput?.(out);
      },
      assistNow: (finger) => {
        if (
          // The coach cannot start help on its own: only after the patient asks.
          (this.onRequest && !this.helpRequested) ||
          this.phase !== 'ATTEMPT' ||
          !this.settings.assist_enabled ||
          !this.input ||
          !motorSafe(this.input) ||
          !Number.isFinite(this.input.tel!.ma) ||
          this.input.tel!.ma >= this.calibration.current_limit_ma ||
          this.pose.closure[finger] === null ||
          !this.assistable()[GLOVE_FINGERS.indexOf(finger)]
        )
          return false;
        this.forced.add(finger);
        const out = output();
        this.scheduleAssist(out);
        options.onTherapyOutput?.(out);
        return true;
      },
      revertIntensity: (dispatch) => {
        this.currentPose = this.therapy.pose(this.basePose);
        if (this.metrics) this.metrics.pose = this.currentPose;
        if (!dispatch) return;
        const out = output();
        if (
          this.scheduler &&
          ['ATTEMPT', 'ASSIST', 'ASSIST_HOLD'].includes(this.phase)
        ) {
          if (!this.input || !motorSafe(this.input)) {
            options.onTherapyOutput?.(this.brake(this.now));
            return;
          }
          this.scheduler.reduceGoals(
            this.currentPose,
            GLOVE_FINGERS.map((f) => this.therapy.targetCap(f)) as Quint,
          );
          this.refreshTarget();
          this.targetSent = false;
          this.sendTarget(out);
        }
        options.onTherapyOutput?.(out);
      },
      sessionControl: (tool) => {
        const action = {
          pause_session: 'pause',
          resume_session: 'resume',
          skip_pose: 'skip',
          stop_session: 'stop',
        } as const;
        options.onTherapyOutput?.(this[action[tool]](this.now));
      },
      onDecision: (d) => options.therapy?.onDecision?.(d),
      onFeeling: (f) => options.therapy?.onFeeling?.(f),
    });
  }

  private therapySnapshot(): Omit<
    LiveTherapyState,
    'adjustments' | 'last_feeling' | 'highlighted_finger'
  > | null {
    if (!this.plan.length) return null;
    const trusted = this.input && visible(this.input);
    const fingers = GLOVE_FINGERS.map((finger, i) => {
      const now = trusted
        ? (this.input!.vision!.closure?.[finger] ?? null)
        : null;
      const target = this.pose.closure[finger];
      return {
        finger,
        now,
        target,
        best_alone: this.metrics?.best[finger] ?? null,
        glove_helping:
          (this.phase === 'ATTEMPT' ||
            this.phase === 'ASSIST' ||
            this.phase === 'ASSIST_HOLD') &&
          !!this.scheduler?.hasStarted(i) &&
          this.targetSent &&
          target !== null &&
          this.target[i] >
            (now === null
              ? (this.input?.tel?.a[i] ?? this.target[i])
              : pullFromClosure(now)) +
              0.02,
        lagging: false,
      };
    });
    const gap = (f: (typeof fingers)[number]) =>
      f.now === null || f.target === null
        ? 0
        : opensFinger(this.pose, f.finger)
          ? Math.max(0, f.now - f.target)
          : Math.max(0, f.target - f.now);
    const maxGap = Math.max(...fingers.map(gap));
    for (const f of fingers)
      f.lagging = maxGap > this.settings.tolerance && gap(f) >= maxGap - 1e-6;
    const last = this.results.at(-1);
    const { phaseElapsed, ...state } = this.state();
    return {
      ...state,
      seconds_in_phase: phaseElapsed,
      glove: {
        state: !this.input?.gloveConnected
          ? 'disconnected'
          : this.input.tel?.st === 'boot'
            ? 'idle'
            : (this.input.tel?.st ?? 'idle'),
        current_ma: this.input?.tel?.ma ?? null,
        simulated: this.options.therapy?.simulated?.() ?? false,
      },
      last_safety: this.lastSafety
        ? {
            source: this.lastSafety.source,
            finger: this.lastSafety.finger,
            seconds_ago: Math.max(0, (this.now - this.lastSafety.at) / 1000),
          }
        : null,
      fingers,
      last_attempt: last
        ? {
            reached_alone: last.reached_active,
            assisted: last.assisted,
            active_ratio: last.active_ratio,
          }
        : null,
    };
  }

  hasAssistance(): boolean {
    return !!this.metrics?.assisted;
  }
  helpOffered(): boolean {
    return (
      this.phase === 'ATTEMPT' &&
      this.helpOfferedAt !== null &&
      !this.helpRequested
    );
  }
  /** The glove only moves when the patient asks: button or voice. */
  requestHelp(now: number): Output {
    this.now = now;
    const out = output();
    if (
      this.phase === 'ATTEMPT' &&
      this.settings.assist_enabled &&
      this.input &&
      motorSafe(this.input) &&
      this.assistable().some(Boolean)
    ) {
      this.helpRequested = true;
      this.enter('ASSIST', out);
    }
    return out;
  }
  private assistClockStart(): number {
    if (this.assistAt !== null) return this.assistAt;
    const due = Math.min(
      ...GLOVE_FINGERS.filter(
        (f, i) => this.assistable()[i] && !this.suppressed.has(f),
      ).map((f) => this.metrics!.start + this.therapy.delay(f) * 1000),
    );
    return Math.max(this.phaseAt, Number.isFinite(due) ? due : this.phaseAt);
  }
  phaseDuration(): number | null {
    if (!this.settings) return null;
    if (this.phase === 'ASSIST')
      return (
        this.settings.assist_max_s +
        (this.assistClockStart() - this.phaseAt) / 1000
      );
    return {
      PRESENT: this.settings.present_s,
      ATTEMPT: this.therapy.attemptSeconds(),
      HOLD: this.therapy.holdSeconds(this.settings.hold_s),
      ASSIST: this.settings.assist_max_s,
      ASSIST_HOLD: this.therapy.holdSeconds(this.settings.hold_s),
      RELEASE: 0.5,
      REST: this.restDuration,
      PAUSED: null,
      DONE: null,
    }[this.phase];
  }

  brake(now: number): Output {
    this.now = now;
    const out = output();
    this.lastSafety = { source: 'coach_brake', finger: null, at: now };
    this.metrics?.safety.push({
      source: 'coach_brake',
      t_rel: (now - this.metrics.start) / 1000,
      finger: null,
      ma: null,
    });
    if (this.phase !== 'DONE' && this.phase !== 'PAUSED') this.interrupt(out);
    else out.commands.push({ t: 'release' });
    return out;
  }

  poseDef(): PoseDef {
    const pose = this.pose;
    if (this.viewPoseSource !== pose) {
      this.viewPoseSource = pose;
      this.viewPose = structuredClone(pose);
    }
    return this.viewPose!;
  }
  private get pose(): PoseDef {
    return this.currentPose ?? this.basePose;
  }
  private get basePose(): PoseDef {
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
    settings: PowerAwareExerciseSettings,
    calibration: Calibration,
    now: number,
  ): Output {
    for (const [key, value] of Object.entries(settings)) {
      if (typeof value === 'number' && (!Number.isFinite(value) || value < 0))
        throw new Error(`Invalid exercise setting: ${key}`);
    }
    if (settings.assist_speed <= 0)
      throw new Error('assist_speed must be positive');
    const stagger = settings.assist_stagger_ms ?? DEFAULT_ASSIST_STAGGER_MS;
    const parallel = settings.assist_max_parallel ?? MAX_ASSIST_PARALLEL;
    if (!Number.isFinite(stagger) || stagger < DEFAULT_ASSIST_STAGGER_MS)
      throw new Error('assist_stagger_ms must be at least 150');
    if (
      !Number.isInteger(parallel) ||
      parallel < 1 ||
      parallel > MAX_ASSIST_PARALLEL
    )
      throw new Error('assist_max_parallel must be an integer from 1 to 3');
    for (const profile of Object.values(this.options.servoProfiles ?? {}))
      if (!Number.isFinite(profile.stall_ma) || profile.stall_ma <= 0)
        throw new Error('Servo stall current must be positive');
    if (
      !Number.isFinite(
        this.options.currentLimitMa ?? calibration.current_limit_ma,
      ) ||
      (this.options.currentLimitMa ?? calibration.current_limit_ma) <= 0
    )
      throw new Error('Current limit must be positive');
    this.settings = {
      ...settings,
      assist_stagger_ms: stagger,
      assist_max_parallel: parallel,
    };
    this.therapy.reset(plan, settings);
    this.currentPose = null;
    this.lastSafety = null;
    this.helped.clear();
    this.suppressed.clear();
    this.forced.clear();
    this.scheduler = null;
    this.assistAt = null;
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
    this.seenSafety.clear();
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
    this.metrics?.observe(input, this.phase, this.helped);
    this.rememberGaps(input);
    let receivedSafety = false;
    for (const event of input.gloveEvents) {
      if (
        event.e !== 'overcurrent' &&
        event.e !== 'stop_button' &&
        event.e !== 'watchdog'
      )
        continue;
      const key = `${event.e}:${event.t}`;
      if (this.seenSafety.has(key)) continue;
      this.seenSafety.add(key);
      this.safety(
        {
          kind: 'safety',
          source: event.e,
          finger: event.e === 'overcurrent' ? this.attribute() : null,
          ma: event.ma ?? input.tel?.ma ?? null,
        },
        out,
      );
      receivedSafety = true;
    }
    if (receivedSafety) return out;
    if (this.phase !== 'PAUSED') {
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
        this.lastSafety = {
          source: 'firmware_fault',
          finger: null,
          at: this.now,
        };
        this.therapy.safety('firmware_fault', null);
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
        if (
          this.settings.assist_enabled &&
          !this.onRequest &&
          this.assistable().some(
            (unreached, i) => unreached && this.eligible(GLOVE_FINGERS[i]),
          )
        ) {
          this.scheduleAssist(out);
          this.collectBaseline();
          if (this.detectResistance(out)) break;
        } else if (!this.metrics?.assisted) this.follow(out);
        else {
          this.governLoad(out);
          this.refreshTarget();
          this.sendTarget(out);
        }
        if (
          this.assistAt !== null &&
          this.now - this.assistAt >= this.settings.assist_max_s * 1000
        ) {
          this.enter('ASSIST_HOLD', out);
          break;
        }
        this.reportProgress(out);
        if (this.reachedDwell()) {
          this.metrics!.reachedActive = !this.metrics!.assisted;
          this.metrics!.reachedFinal = true;
          this.metrics!.timeToPosition = this.metrics!.assisted
            ? null
            : (this.dwellAt! - this.metrics!.start) / 1000;
          out.events.push({
            kind: 'reached',
            assisted: this.metrics!.assisted,
            t_rel: (this.dwellAt! - this.metrics!.start) / 1000,
          });
          this.enter(this.metrics!.assisted ? 'ASSIST_HOLD' : 'HOLD', out);
        } else if (this.helpOfferedAt !== null) {
          // Help offered: wait for the patient to reach it alone (dwell above) or to ask
          // (requestHelp). Only the end of the offer ends the attempt.
          if (
            this.now - this.helpOfferedAt >=
            (this.settings.help_offer_s ?? 8) * 1000
          )
            this.enter('RELEASE', out);
        } else if (
          elapsed >= this.therapy.attemptSeconds() ||
          this.isPlateau()
        ) {
          const canHelp =
            this.settings.assist_enabled && this.assistable().some(Boolean);
          if (canHelp && this.onRequest) {
            // Never move on its own: offer help and wait for the patient to ask.
            this.helpOfferedAt = this.now;
            out.events.push({
              kind: 'help_offered',
              fingers: GLOVE_FINGERS.filter((_, i) => this.assistable()[i]),
            });
          } else this.enter(canHelp ? 'ASSIST' : 'RELEASE', out);
        }
        break;
      case 'HOLD':
        this.follow(out);
        if (elapsed >= this.therapy.holdSeconds(this.settings.hold_s))
          this.enter('RELEASE', out);
        break;
      case 'ASSIST':
        this.assist(out);
        break;
      case 'ASSIST_HOLD':
        this.governLoad(out);
        if (!this.resistance) this.detectResistance(out);
        this.refreshTarget();
        this.sendTarget(out);
        if (elapsed >= this.therapy.holdSeconds(this.settings.hold_s))
          this.enter('RELEASE', out);
        break;
      case 'RELEASE':
        if (elapsed >= 0.5) {
          this.record(out);
          this.enter('REST', out);
        }
        break;
      case 'REST':
        if (elapsed >= this.restDuration) this.next(out);
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
    const continuingAssist =
      (this.phase === 'ASSIST' && phase === 'ASSIST_HOLD') ||
      (this.phase === 'ATTEMPT' &&
        !!this.metrics?.assisted &&
        (phase === 'ASSIST' || phase === 'ASSIST_HOLD'));
    const overrides = this.therapy.boundary(phase);
    const canceled = this.therapy.takeCanceled(this.index);
    for (const finger of canceled) {
      this.forced.delete(finger);
      this.suppressed.add(finger);
      this.scheduler?.suspend(
        GLOVE_FINGERS.indexOf(finger),
        this.input?.tel?.a[GLOVE_FINGERS.indexOf(finger)] ?? 0,
      );
    }
    if (phase === 'PRESENT' && overrides.next_pose && this.plan[this.index])
      this.plan[this.index] = {
        ...this.plan[this.index],
        pose: overrides.next_pose,
      };
    if (phase === 'REST')
      this.restDuration = this.settings.rest_s + overrides.extra_rest_s;
    this.phase = phase;
    this.phaseAt = this.now;
    this.resetDwell();
    this.settledAt = null;
    if (!continuingAssist) {
      this.lowAt = null;
      this.releasedForVision = false;
    }
    // The new attempt's pose must be in place before announcing the phase: the coach
    // speaks from this event, and the previous pose here made it say "make a fist"
    // while the screen asked to open.
    if (phase === 'PRESENT' || phase === 'ATTEMPT')
      this.currentPose = this.therapy.pose(this.basePose);
    this.phaseEvent(out);
    if (phase === 'PRESENT' || phase === 'RELEASE' || phase === 'PAUSED')
      out.commands.push({ t: 'release' });
    if (phase === 'PRESENT') {
      this.visibleAt = null;
      this.repromptAt = this.now;
      this.lastFollow = null;
    }
    if (phase === 'ATTEMPT') {
      this.helpRequested = false;
      this.helpOfferedAt = null;
      this.scheduler = null;
      this.targetSent = false;
      this.helped.clear();
      this.suppressed.clear();
      this.forced.clear();
      this.assistAt = null;
      this.baseline = [];
      this.baselineTel = null;
      this.high = null;
      this.resistance = false;
      this.loadHighAt = null;
      this.loadBlocked = false;
      this.metrics = new AttemptMetrics(
        this.pose,
        this.rep,
        this.index,
        this.now,
        this.options.timestamp ?? isoTime,
        this.settings.tolerance,
      );
      this.metrics.observe(this.input!, phase);
      this.progress.clear();
      this.plateau = [{ now: this.now, best: { ...this.metrics.best } }];
      this.gaps = [];
      this.reachedDwell();
    }
    if (phase === 'ASSIST_HOLD' && canceled.length) {
      this.refreshTarget();
      this.targetSent = false;
      this.sendTarget(out);
    }
    if (phase === 'ASSIST') {
      this.currentPose = this.therapy.pose(this.basePose);
      if (this.metrics) this.metrics.pose = this.currentPose;
      this.scheduler?.reduceGoals(
        this.currentPose,
        GLOVE_FINGERS.map((f) => this.therapy.targetCap(f)) as Quint,
      );
      this.scheduleAssist(out);
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
    const count = this.therapy.takeRepeats();
    const current = this.plan[this.index];
    if (count && current) {
      const lastRep = Math.max(
        ...this.plan.filter((p) => p.pose === current.pose).map((p) => p.rep),
      );
      this.plan.splice(
        this.index + 1,
        0,
        ...Array.from({ length: count }, (_, i) => ({
          pose: current.pose,
          rep: lastRep + i + 1,
        })),
      );
    }
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
    this.therapy.safety(event.source, event.finger);
    this.lastSafety = {
      source: event.source,
      finger: event.finger,
      at: this.now,
    };
    out.events.push(event);
    this.metrics?.safety.push({
      source: event.source,
      t_rel: (this.now - this.metrics.start) / 1000,
      finger: event.finger,
      ma: event.ma,
    });
    if (this.phase !== 'PAUSED') this.interrupt(out);
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
    if (
      this.phase !== 'ASSIST' &&
      this.phase !== 'ASSIST_HOLD' &&
      !(this.phase === 'ATTEMPT' && this.metrics?.assisted)
    )
      return true;
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
      out.commands.push({
        t: 'follow',
        f: closure(this.input!).map(pullFromClosure) as Quint,
      });
      this.lastFollow = this.input!.vision!.t;
    }
  }
  private fingerReached(f: GloveFinger): boolean {
    const rawTarget = this.pose.closure[f];
    const target =
      rawTarget === null
        ? null
        : this.phase === 'ASSIST' || this.phase === 'ASSIST_HOLD'
          ? Math.max(rawTarget, closureFromPull(this.therapy.targetCap(f)))
          : rawTarget;
    const value = this.input!.vision?.closure?.[f];
    return (
      target === null ||
      (value !== undefined &&
        (opensFinger(this.pose, f)
          ? value <= target + this.settings.tolerance
          : value >= target - this.settings.tolerance))
    );
  }
  private resetDwell(): void {
    this.dwellAt = null;
    this.dwellGapAt = null;
    this.dwellPausedMs = 0;
  }

  /** 06-session §3 reach: count visible dwell time, tolerating gaps of at most 200 ms. */
  private reachedDwell(): boolean {
    if (!visible(this.input!)) {
      if (this.dwellAt !== null) {
        this.dwellGapAt ??= this.now;
        if (this.now - this.dwellGapAt > DWELL_GAP_MS) this.resetDwell();
      }
      return false;
    }
    if (this.dwellGapAt !== null) {
      const gap = this.now - this.dwellGapAt;
      if (gap > DWELL_GAP_MS) this.resetDwell();
      else {
        this.dwellPausedMs += gap;
        this.dwellGapAt = null;
      }
    }
    if (
      !GLOVE_FINGERS.every((f) => this.fingerReached(f)) ||
      (this.pose.pinch &&
        (this.input!.vision!.pinch === null ||
          this.input!.vision!.pinch! > this.pose.pinch.max_ratio))
    ) {
      this.resetDwell();
      return false;
    }
    this.dwellAt ??= this.now;
    // Keep dwellAt on the first satisfying frame for t_rel/time_to_position_s.
    return (
      this.now - this.dwellAt - this.dwellPausedMs >=
      this.settings.reach_dwell_s * 1000
    );
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
      return (opensFinger(this.pose, f) ? prior - best : best - prior) <= 0.03;
    });
  }
  private assistable(): boolean[] {
    return GLOVE_FINGERS.map((f) => {
      const target = this.pose.closure[f];
      const value = this.input?.vision?.closure?.[f];
      // The glove only opens: it never pulls on a finger meant to stay closed.
      return (
        target !== null &&
        opensFinger(this.pose, f) &&
        value !== undefined &&
        value > target + this.settings.tolerance
      );
    });
  }
  private eligible(finger: GloveFinger): boolean {
    // Asked for help: every finger that needs opening is helped now (no extra waiting).
    if (this.helpRequested) return !this.suppressed.has(finger);
    return (
      !this.suppressed.has(finger) &&
      (this.forced.has(finger) ||
        (this.metrics !== null &&
          (this.now - this.metrics.start) / 1000 >= this.therapy.delay(finger)))
    );
  }
  private refreshTarget(): void {
    if (!this.scheduler || !this.input?.tel) return;
    if (visible(this.input))
      this.scheduler.refreshHeld(this.input.tel.a, closure(this.input));
    const target: Quint = this.resistance
      ? (this.scheduler.target.map((v, i) =>
          Math.min(
            v,
            this.target[i],
            heldPull(this.input!.tel!.a[i], closure(this.input!)[i]),
          ),
        ) as Quint)
      : [...this.scheduler.target];
    if (target.some((v, i) => Math.abs(v - this.target[i]) > 1e-6))
      this.targetSent = false;
    this.target = target;
  }
  private scheduleAssist(out: Output): void {
    if (!motorSafe(this.input!)) return;
    this.governLoad(out);
    this.scheduler ??= new AssistScheduler(
      this.pose,
      [...this.input!.tel!.a],
      this.settings.assist_stagger_ms!,
      this.settings.assist_max_parallel!,
      GLOVE_FINGERS.map((f) => this.therapy.targetCap(f)) as Quint,
    );
    this.refreshTarget();
    const first = !this.metrics!.assisted;
    const eligible = this.assistable().map(
      (value, i) => value && this.eligible(GLOVE_FINGERS[i]),
    );
    const changed = this.scheduler.advance(
      this.now,
      this.input!.tel!.a,
      closure(this.input!),
      eligible,
      this.loadBlocked || this.resistance,
    );
    if (changed) {
      this.metrics!.assisted = true;
      this.assistAt ??= this.now;
      for (const [i, finger] of GLOVE_FINGERS.entries())
        if (this.scheduler.hasStarted(i)) this.helped.add(finger);
      if (first)
        out.events.push({
          kind: 'assist_started',
          fingers: GLOVE_FINGERS.filter((_, i) => eligible[i]),
          from: closure(this.input!),
          to: this.scheduler.goal.map(closureFromPull) as Quint,
        });
      this.settledAt = null;
    }
    const previous = this.target;
    this.refreshTarget();
    if (changed || previous.some((v, i) => Math.abs(v - this.target[i]) > 1e-6))
      this.targetSent = false;
    if (this.metrics!.assisted) this.sendTarget(out);
  }
  private sendTarget(out: Output): void {
    if (
      this.scheduler &&
      this.metrics?.assisted &&
      motorSafe(this.input!) &&
      !this.targetSent
    ) {
      const moving = GLOVE_FINGERS.filter(
        (_, i) => this.target[i] > this.input!.tel!.a[i] + 1e-6,
      );
      const capped = moving.length ? moving : GLOVE_FINGERS;
      out.commands.push({
        t: 'target',
        f: [...this.target],
        // The wire has one speed: take the minimum cap of every moving servo.
        v: Math.min(0.3, ...capped.map((finger) => this.therapy.speed(finger))),
      });
      this.targetSent = true;
    }
  }

  /** 06-session §3 ASSIST row: reach, settle, time cap, or resistance ends assistance. */
  private assist(out: Output): void {
    const input = this.input!;
    const elapsed = this.now - this.assistClockStart();
    this.collectBaseline();
    this.governLoad(out);
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
    this.scheduleAssist(out);
    if (
      this.targetSent &&
      input.tel &&
      this.scheduler?.complete(
        input.tel.a,
        closure(input),
        this.assistable(),
      ) &&
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
  /** Sustained flexor tone also loads stationary tendons during the hold. */
  private governLoad(out: Output): void {
    const tel = this.input?.tel;
    const ceiling =
      0.8 * (this.options.currentLimitMa ?? this.calibration.current_limit_ma);
    if (!tel || !Number.isFinite(tel.ma) || tel.ma <= ceiling) {
      this.loadHighAt = null;
      this.loadBlocked = false;
      return;
    }
    // Block new starts immediately; shed only after 200 ms of sustained load.
    this.loadBlocked = true;
    this.loadHighAt ??= this.now;
    if (this.now - this.loadHighAt < 200 || !motorSafe(this.input!)) return;
    this.loadHighAt = this.now;
    const i = this.scheduler?.shedLoad(tel.a, closure(this.input!));
    if (i === null || i === undefined) return;
    this.metrics?.safety.push({
      source: 'load_shed',
      finger: GLOVE_FINGERS[i],
      ma: tel.ma,
      t_rel: (this.now - this.metrics.start) / 1000,
    });
    this.refreshTarget();
    this.sendTarget(out);
  }
  private collectBaseline(): void {
    const tel = this.input!.tel;
    if (
      this.assistAt !== null &&
      this.now - this.assistAt <= 300 &&
      tel &&
      tel.t !== this.baselineTel
    ) {
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
          (f, i) =>
            input.tel!.a[i] - pullFromClosure(input.vision!.closure![f]),
        ) as Quint,
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
      this.assistAt === null ||
      this.now - this.assistAt <= 300 ||
      !this.baseline.length
    )
      return false;
    const sorted = [...this.baseline].sort((a, b) => a - b);
    const baseline =
      (sorted[Math.floor((sorted.length - 1) / 2)] +
        sorted[Math.floor(sorted.length / 2)]) /
      2;
    const finger = this.attribute();
    const profile = finger
      ? (this.options.servoProfiles?.[finger] ?? SERVO_PROFILES[finger])
      : null;
    // Preserve the 250 mA threshold for the strongest servo; weaker profiles stop earlier.
    const threshold = profile
      ? Math.min(250, profile.stall_ma * (250 / 800))
      : 250;
    const gap = finger
      ? tel.a[GLOVE_FINGERS.indexOf(finger)] -
        pullFromClosure(this.input!.vision!.closure![finger])
      : 0;
    // Stagger changes total current as each motor starts. Require real pulling
    // lag, rather than classifying a settled finger's camera noise as a stall.
    // The first assist samples may already contain a stalled finger (for
    // example rigidity enabled after follow). Never learn that load as safe.
    // Total current cannot identify a servo: require a substantial command/vision
    // gap and stalled vision as well as stall-level aggregate current.
    const loadedStall =
      profile !== null && tel.ma >= profile.stall_ma && gap > 0.1;
    if (
      (!loadedStall && tel.ma <= baseline + threshold) ||
      !finger ||
      gap <= 0.05
    ) {
      this.high = null;
      return false;
    }
    if (!this.high || this.high.finger !== finger)
      this.high = {
        at: this.now,
        finger,
        closure: this.input!.vision!.closure![finger],
      };
    if (this.high.closure - this.input!.vision!.closure![finger] > 0.02) {
      this.high = {
        at: this.now,
        finger,
        closure: this.input!.vision!.closure![finger],
      };
      return false;
    }
    if (this.now - this.high.at < 200) return false;
    this.resistance = true;
    this.lastSafety = { source: 'resistance', finger, at: this.now };
    this.therapy.resistance(finger);
    this.currentPose = this.therapy.pose(this.basePose);
    if (this.metrics) this.metrics.pose = this.currentPose;
    this.scheduler?.reduceGoals(
      this.currentPose,
      GLOVE_FINGERS.map((f) => this.therapy.targetCap(f)) as Quint,
    );
    out.events.push({ kind: 'resistance', finger, ma: tel.ma });
    this.metrics!.safety.push({
      source: 'resistance',
      t_rel: (this.now - this.metrics!.start) / 1000,
      finger,
      ma: tel.ma,
    });
    this.target = tel.a.map((a, i) =>
      Math.min(a, this.scheduler?.goal[i] ?? a),
    ) as Quint;
    for (const [i, value] of this.target.entries())
      this.scheduler?.suspend(i, value);
    this.targetSent = false;
    this.sendTarget(out);
    if (this.phase !== 'ASSIST_HOLD') this.enter('ASSIST_HOLD', out);
    return true;
  }
}

export function createExerciseEngine(
  options: EngineOptions = {},
): ExerciseEngine {
  return new Exercise(options);
}
