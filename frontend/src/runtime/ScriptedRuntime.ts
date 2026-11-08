import { TherapyController } from '../engine/therapy';
import type { TherapyRuntime } from './therapy';
import { createStore } from 'zustand/vanilla';
import type {
  Runtime,
  ExerciseView,
  EvaluationView,
} from '../contracts/runtime';
import type {
  ExercisePlanItem,
  ExercisePhase,
  EngineEvent,
  AttemptResult,
  AttemptTrace,
  SessionSummary,
} from '../contracts/engine';
import type {
  EvalSettings,
  EvaluationResult,
  EvalSweep,
} from '../contracts/evaluation';
import type { GloveFinger } from '../contracts/glove';
import {
  CURRENT_ASSIST_DIRECTION,
  type Calibration,
  type FrictionCurve,
} from '../contracts/calibration';
import { GLOVE_FINGERS, pullFromClosure } from '../contracts/glove';
import { POSES, DEFAULT_EXERCISE_SETTINGS } from '../contracts/poses';
import * as fixture from '../contracts/fixtures.check';
import * as api from '../api/client';

const initialExercise = (): ExerciseView => ({
  phase: 'DONE',
  pose: POSES.open,
  rep: 1,
  index: 0,
  total: 0,
  phaseElapsed: 0,
  phaseDuration: null,
  activeMax: {},
  assisting: false,
  paused: false,
  sessionId: null,
  lastResult: null,
  summary: null,
});
const initialEvaluation = (): EvaluationView => ({
  stage: 'idle',
  finger: null,
  speed: null,
  progress: 0,
  result: null,
});
const emptyTrace = (): AttemptTrace => ({
  hz: 20,
  t: [],
  closure: { thumb: [], index: [], middle: [], ring: [], pinky: [] },
  servo: { thumb: [], index: [], middle: [], ring: [], pinky: [] },
  ma: [],
  phase: [],
});

/** WP0 UI development script. It never calls a glove or an engine. WP10 replaces it. */
export class ScriptedRuntime implements TherapyRuntime {
  readonly exerciseStore = createStore<ExerciseView>(initialExercise);
  readonly evaluationStore = createStore<EvaluationView>(initialEvaluation);
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(event: EngineEvent) => void>();
  private items: { pose: ExercisePlanItem['pose']; rep: number }[] = [];
  private settings = DEFAULT_EXERCISE_SETTINGS;
  private results: AttemptResult[] = [];
  private trace = emptyTrace();
  private attemptStarted = '';
  private attemptTime = 0;
  private elapsed = 0;
  private resistanceSent = false;
  private resistedThisAttempt = false;
  private interrupted = false;
  private pending: Promise<unknown> = Promise.resolve();
  private evalSettings: EvalSettings | null = null;
  private evalSweeps: EvalSweep[] = [];
  private evalIndex = 0;
  private evalStarted = '';
  private persist: boolean;
  private generation = 0;
  private therapyClock = 0;
  private lastSafety: {
    source: string;
    finger: GloveFinger | null;
    at: number;
  } | null = null;
  private readonly therapyController = new TherapyController({
    sessionId: () => this.exercise.view().sessionId,
    now: () => this.therapyClock,
    snapshot: () => {
      const v = this.exercise.view();
      if (!v.total) return null;
      const last = v.lastResult;
      return {
        phase: v.phase,
        pose: v.pose.id,
        rep: v.rep,
        index: v.index,
        total: v.total,
        seconds_in_phase: v.phaseElapsed,
        glove: {
          state: v.assisting ? 'run' : 'idle',
          current_ma: v.assisting ? 270 : 90,
          simulated: true,
        },
        last_safety: this.lastSafety
          ? {
              source: this.lastSafety.source,
              finger: this.lastSafety.finger,
              seconds_ago: (this.therapyClock - this.lastSafety.at) / 1000,
            }
          : null,
        fingers: GLOVE_FINGERS.map((finger) => ({
          finger,
          now: v.activeMax[finger] ?? null,
          target: v.pose.closure[finger],
          best_alone: v.activeMax[finger] ?? null,
          glove_helping: v.assisting && v.pose.closure[finger] !== null,
          lagging: false,
        })),
        last_attempt: last
          ? {
              reached_alone: last.reached_active,
              assisted: last.assisted,
              active_ratio: last.active_ratio,
            }
          : null,
      };
    },
    brake: () => {
      this.lastSafety = {
        source: 'coach_brake',
        finger: null,
        at: this.therapyClock,
      };
      this.interrupted = true;
      this.exercise.pause();
      void this.evaluation.stop();
    },
    assistNow: (finger) => {
      const v = this.exercise.view();
      if (
        v.phase !== 'ATTEMPT' ||
        !this.settings.assist_enabled ||
        v.pose.closure[finger] === null
      )
        return false;
      this.exerciseStore.setState({ assisting: true });
      return true;
    },
    revertIntensity: () => {
      this.exerciseStore.setState({
        pose: this.therapyController.pose(POSES[this.exercise.view().pose.id]),
      });
    },
    sessionControl: (tool) => {
      const action = {
        pause_session: 'pause',
        resume_session: 'resume',
        skip_pose: 'skip',
        stop_session: 'stop',
      } as const;
      void this.exercise[action[tool]]();
    },
    lowerHelp: () => {
      /* This UI script has no motors. */
    },
  });
  readonly therapy: TherapyRuntime['therapy'] = this.therapyController;
  constructor(options: { persist?: boolean } = {}) {
    this.persist = options.persist ?? true;
  }
  sources: Runtime['sources'] = {
    glove: 'sim',
    vision: 'sim',
    setGlove: async (k) => {
      if (k !== 'sim') throw new Error('Serial comes in WP2');
    },
    setVision: async (k) => {
      if (k !== 'sim') throw new Error('Camera comes in WP3');
    },
  };
  calibration: Runtime['calibration'] = {
    current: structuredClone(fixture.calibration) as Calibration,
    reload: async () => {
      this.calibration.current = await api.getLatestCalibration();
    },
    save: async (c) => {
      const saved = await api.createCalibration({
        ...c,
        assist_direction: CURRENT_ASSIST_DIRECTION,
      });
      this.calibration.current = saved;
      return saved;
    },
    sendToGlove: async () => {
      /* WP10 wires the real glove; this script never moves hardware. */
    },
  };
  exercise: Runtime['exercise'] = {
    start: async (plan, settings) => {
      if (
        !plan.length ||
        plan.some((x) => !Number.isInteger(x.reps) || x.reps < 1)
      )
        throw new Error('Choose at least one pose and repetition');
      this.dispose();
      const generation = ++this.generation;
      this.evalSettings = null;
      this.evaluationStore.setState(initialEvaluation(), true);
      this.items = plan.flatMap((item) =>
        Array.from({ length: item.reps }, (_, i) => ({
          pose: item.pose,
          rep: i + 1,
        })),
      );
      this.settings = { ...settings };
      this.therapyController.reset(plan, settings);
      this.therapyClock = 0;
      this.lastSafety = null;
      this.results = [];
      this.resistanceSent = false;
      this.exerciseStore.setState(
        { ...initialExercise(), total: this.items.length },
        true,
      );
      this.beginAttempt(0);
      if (this.persist) {
        try {
          const session = await api.createSession({
            mode: 'exercise',
            plan,
            settings,
            calibration_id: this.calibration.current?.id ?? 1,
            is_demo: true,
          });
          if (generation === this.generation)
            this.exerciseStore.setState({ sessionId: session.id });
        } catch {
          /* WP5 is still a 501 scaffold. Exercise script remains usable. */
        }
      }
      if (
        generation === this.generation &&
        this.exercise.view().phase !== 'DONE'
      )
        this.startClock();
    },
    pause: () => {
      if (!['DONE', 'PAUSED'].includes(this.exercise.view().phase))
        this.phase('PAUSED');
    },
    resume: () => {
      if (this.exercise.view().phase === 'PAUSED') {
        this.interrupted = true;
        this.phase('RELEASE');
      }
    },
    skip: () => {
      if (this.exercise.view().phase !== 'DONE') {
        this.interrupted = true;
        this.phase('RELEASE');
      }
    },
    stop: async () => {
      this.generation++;
      if (this.exercise.view().phase !== 'DONE') {
        this.interrupted = true;
        if (this.trace.t.length) this.finishAttempt();
        this.finishSession();
      }
      await this.pending;
    },
    view: () => this.exerciseStore.getState(),
    subscribe: (cb) => this.exerciseStore.subscribe(cb),
    onEvent: (cb) => {
      this.listeners.add(cb);
      return () => {
        this.listeners.delete(cb);
      };
    },
  };
  evaluation: Runtime['evaluation'] = {
    start: async (settings) => {
      if (!settings.fingers.length)
        throw new Error('Choose at least one finger');
      this.dispose();
      this.generation++;
      this.exerciseStore.setState(initialExercise(), true);
      this.evalSettings = settings;
      this.evalSweeps = [];
      this.evalIndex = 0;
      this.elapsed = 0;
      this.evalStarted = new Date().toISOString();
      this.evaluationStore.setState(
        {
          stage: 'prepare',
          finger: settings.fingers[0],
          speed: 'slow',
          progress: 0,
          result: null,
        },
        true,
      );
      this.startClock();
    },
    stop: async () => {
      if (!this.evalSettings) return;
      this.dispose();
      this.generation++;
      this.evalSettings = null;
      this.evaluationStore.setState({ stage: 'aborted' });
    },
    view: () => this.evaluationStore.getState(),
    subscribe: (cb) => this.evaluationStore.subscribe(cb),
    runFriction: async (fingers) =>
      Object.fromEntries(
        fingers.map((f) => [
          f,
          structuredClone(fixture.calibration.friction[f]),
        ]),
      ) as Partial<Record<GloveFinger, FrictionCurve[]>>,
  };
  private emit(event: EngineEvent) {
    this.listeners.forEach((cb) => cb(event));
  }
  private startClock() {
    this.timer = setInterval(() => this.advance(0.05), 50);
  }
  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  private queue(job: () => Promise<unknown>) {
    this.pending = this.pending.then(job).catch(() => {
      /* Storage stubs must not stop UI development. WP10 adds a retry queue. */
    });
  }
  private beginAttempt(index: number) {
    const item = this.items[index];
    this.trace = emptyTrace();
    this.attemptTime = 0;
    this.attemptStarted = new Date().toISOString();
    this.interrupted = false;
    this.resistedThisAttempt = false;
    this.exerciseStore.setState({
      pose: POSES[item.pose],
      rep: item.rep,
      index,
      activeMax: {},
      lastResult: this.results.at(-1) ?? null,
    });
    this.phase('PRESENT');
  }
  private duration(phase: ExercisePhase) {
    const s = this.settings;
    return {
      PRESENT: s.present_s,
      ATTEMPT: this.therapyController.attemptSeconds(),
      HOLD: this.therapyController.holdSeconds(s.hold_s),
      ASSIST: Math.min(2, s.assist_max_s),
      ASSIST_HOLD: this.therapyController.holdSeconds(s.hold_s),
      RELEASE: 0.5,
      REST: s.rest_s + this.therapyController.current().extra_rest_s,
      PAUSED: null,
      DONE: null,
    }[phase];
  }
  private phase(phase: ExercisePhase) {
    const overrides = this.therapyController.boundary(phase);
    if (phase === 'PRESENT' && overrides.next_pose) {
      const index = this.exercise.view().index;
      this.items[index] = { ...this.items[index], pose: overrides.next_pose };
      this.exerciseStore.setState({ pose: POSES[overrides.next_pose] });
    }
    if (phase === 'ATTEMPT')
      this.exerciseStore.setState({
        pose: this.therapyController.pose(POSES[this.exercise.view().pose.id]),
      });
    this.elapsed = 0;
    this.exerciseStore.setState({
      phase,
      phaseElapsed: 0,
      phaseDuration: this.duration(phase),
      paused: phase === 'PAUSED',
      assisting: phase === 'ASSIST' || phase === 'ASSIST_HOLD',
    });
    const v = this.exercise.view();
    this.emit({
      kind: 'phase',
      phase,
      pose: v.pose.id,
      rep: v.rep,
      index: v.index,
    });
    if (phase === 'ASSIST')
      this.emit({
        kind: 'assist_started',
        fingers: GLOVE_FINGERS.filter((f) => v.pose.closure[f] !== null),
        from: GLOVE_FINGERS.map((f) => v.activeMax[f] ?? 0) as [
          number,
          number,
          number,
          number,
          number,
        ],
        to: GLOVE_FINGERS.map((f) => v.pose.closure[f] ?? 0) as [
          number,
          number,
          number,
          number,
          number,
        ],
      });
    if (phase === 'HOLD' || phase === 'ASSIST_HOLD')
      this.emit({
        kind: 'reached',
        t_rel: this.attemptTime,
        assisted: phase === 'ASSIST_HOLD',
      });
  }
  /** Advances fake time in seconds; useful for deterministic page/voice tests. */
  advance(dt: number) {
    this.therapyClock += dt * 1000;
    if (this.evalSettings) {
      this.advanceEvaluation(dt);
      return;
    }
    const v = this.exercise.view();
    if (v.phase === 'DONE' || v.paused) return;
    this.elapsed += dt;
    this.exerciseStore.setState({ phaseElapsed: this.elapsed });
    if (v.phase === 'ATTEMPT') {
      const activeMax = { ...v.activeMax };
      for (const finger of GLOVE_FINGERS) {
        const target = v.pose.closure[finger];
        if (target === null) continue;
        const ratio = v.index % 2 ? 1 : Math.min(0.9, 0.55 + v.index * 0.025);
        activeMax[finger] =
          target === 0
            ? Math.max(0.02, 0.5 * (1 - this.elapsed / this.settings.attempt_s))
            : target *
              ratio *
              Math.min(
                1,
                this.elapsed / Math.max(0.1, this.settings.attempt_s * 0.7),
              );
        if (Math.round(this.elapsed * 20) % 10 === 0)
          this.emit({
            kind: 'progress',
            finger,
            active_max: activeMax[finger]!,
          });
      }
      this.exerciseStore.setState({ activeMax });
    }
    if (
      ['ATTEMPT', 'HOLD', 'ASSIST', 'ASSIST_HOLD', 'RELEASE'].includes(v.phase)
    )
      this.sampleTrace(dt);
    if (v.phase === 'ASSIST' && this.elapsed >= 1 && !this.resistanceSent) {
      this.lastSafety = {
        source: 'resistance',
        finger: 'index',
        at: this.therapyClock,
      };
      this.therapyController.resistance('index');
      this.resistanceSent = true;
      this.resistedThisAttempt = true;
      this.emit({ kind: 'resistance', finger: 'index', ma: 570 });
    }
    const duration = this.duration(v.phase);
    if (duration === null || this.elapsed + 1e-8 < duration) return;
    switch (v.phase) {
      case 'PRESENT':
        this.phase('ATTEMPT');
        break;
      case 'ATTEMPT':
        this.phase(
          v.pose.id === 'open' || v.index % 2 === 1
            ? 'HOLD'
            : this.settings.assist_enabled
              ? 'ASSIST'
              : 'RELEASE',
        );
        break;
      case 'HOLD':
      case 'ASSIST_HOLD':
        this.phase('RELEASE');
        break;
      case 'ASSIST':
        this.phase('ASSIST_HOLD');
        break;
      case 'RELEASE':
        this.finishAttempt();
        this.phase('REST');
        break;
      case 'REST': {
        const count = this.therapyController.takeRepeats();
        const rep = Math.max(
          ...this.items.filter((i) => i.pose === v.pose.id).map((i) => i.rep),
        );
        this.items.splice(
          v.index + 1,
          0,
          ...Array.from({ length: count }, (_, i) => ({
            pose: v.pose.id,
            rep: rep + i + 1,
          })),
        );
        if (count) this.exerciseStore.setState({ total: this.items.length });
        if (v.index + 1 < this.items.length) this.beginAttempt(v.index + 1);
        else this.finishSession();
        break;
      }
    }
  }
  private sampleTrace(dt: number) {
    const v = this.exercise.view();
    this.trace.t.push(Number(this.attemptTime.toFixed(3)));
    this.attemptTime += dt;
    for (const f of GLOVE_FINGERS) {
      const active = v.activeMax[f] ?? 0,
        target = v.pose.closure[f] ?? active;
      const value = v.assisting
        ? active +
          (target - active) *
            (v.phase === 'ASSIST_HOLD'
              ? 1
              : Math.min(
                  1,
                  this.elapsed / Math.max(0.05, this.duration('ASSIST')!),
                ))
        : active;
      this.trace.closure[f].push(
        this.resistedThisAttempt && f === 'index' ? active : value,
      );
      this.trace.servo[f].push(
        v.phase === 'RELEASE' ? 0 : Math.max(0, pullFromClosure(value) - 0.08),
      );
    }
    this.trace.phase.push(v.phase);
    this.trace.ma.push(
      v.assisting ? (this.resistedThisAttempt ? 570 : 270) : 90,
    );
  }
  private finishAttempt() {
    if (this.results.some((r) => r.index === this.exercise.view().index))
      return;
    const v = this.exercise.view(),
      assisted = this.trace.phase.includes('ASSIST');
    let holdIndex = this.trace.phase.length - 1;
    while (holdIndex > 0 && this.trace.phase[holdIndex] === 'RELEASE')
      holdIndex--;
    const active = !assisted && (v.pose.id === 'open' || v.index % 2 === 1);
    const result: AttemptResult = {
      pose: v.pose.id,
      rep: v.rep,
      index: v.index,
      started_at: this.attemptStarted,
      ended_at: new Date().toISOString(),
      reached_active: active && !this.interrupted,
      reached_final:
        !this.interrupted &&
        (active || (assisted && !this.resistedThisAttempt)),
      assisted,
      time_to_position_s: active ? this.settings.attempt_s : null,
      active_ratio: 0,
      fingers: Object.entries(v.pose.closure).map(([finger, target]) => {
        const scored =
          GLOVE_FINGERS.includes(finger as GloveFinger) && target !== null;
        const max = scored ? (v.activeMax[finger as GloveFinger] ?? 0) : null;
        return {
          finger: finger as AttemptResult['fingers'][number]['finger'],
          scored,
          target,
          active_max: max,
          assist_needed: scored
            ? target === 0
              ? max
              : Math.max(0, target! - max!)
            : null,
          final: scored
            ? (this.trace.closure[finger as GloveFinger][holdIndex] ?? max)
            : null,
        };
      }),
      pinch_min: v.pose.id === 'pinch' ? 0.12 : null,
      current_peak_ma: assisted ? (this.resistedThisAttempt ? 570 : 270) : null,
      current_mean_ma: assisted ? 270 : null,
      safety_events: this.resistedThisAttempt
        ? [
            {
              source: 'resistance',
              t_rel: this.settings.attempt_s + 1,
              finger: 'index',
              ma: 570,
            },
          ]
        : [],
      interrupted: this.interrupted,
      trace: structuredClone(this.trace),
    };
    const scored = result.fingers.filter((f) => f.scored);
    result.active_ratio =
      scored.reduce(
        (sum, f) =>
          sum +
          (f.target === 0
            ? 1 - f.active_max!
            : Math.min(1, f.active_max! / f.target!)),
        0,
      ) / Math.max(1, scored.length);
    this.results.push(result);
    this.exerciseStore.setState({ lastResult: result });
    this.emit({ kind: 'attempt_done', result });
    const id = v.sessionId;
    if (this.persist && id !== null)
      this.queue(() => api.addAttempt({ id, result }));
  }
  private finishSession() {
    this.dispose();
    const results = this.results,
      mean = (a: number[]) =>
        a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const summary: SessionSummary = {
      attempts: results.length,
      reached_active: results.filter((r) => r.reached_active).length,
      assisted: results.filter((r) => r.assisted).length,
      interrupted: results.filter((r) => r.interrupted).length,
      active_ratio_mean: mean(results.map((r) => r.active_ratio)),
      per_pose: [...new Set(results.map((r) => r.pose))].map((pose) => {
        const rs = results.filter((r) => r.pose === pose);
        return {
          pose,
          active_ratio_mean: mean(rs.map((r) => r.active_ratio)),
          assisted: rs.filter((r) => r.assisted).length,
          reps: rs.length,
        };
      }),
      per_finger: GLOVE_FINGERS.map((finger) => {
        const ms = results
          .flatMap((r) => r.fingers)
          .filter((f) => f.finger === finger && f.scored);
        return {
          finger,
          active_max_mean: ms.length
            ? mean(ms.map((f) => f.active_max!))
            : null,
          assist_needed_mean: ms.length
            ? mean(ms.map((f) => f.assist_needed!))
            : null,
        };
      }),
      previous: null,
    };
    this.exerciseStore.setState({ summary });
    this.phase('DONE');
    this.emit({ kind: 'session_done', summary });
    const id = this.exercise.view().sessionId;
    if (this.persist && id !== null)
      this.queue(() => api.endSession({ id, summary }));
  }
  private advanceEvaluation(dt: number) {
    const settings = this.evalSettings!;
    this.elapsed += dt;
    const view = this.evaluation.view();
    if (view.stage === 'prepare' && this.elapsed >= 1) {
      this.elapsed = 0;
      this.evaluationStore.setState({ stage: 'sweep' });
    } else if (view.stage === 'sweep') {
      this.evaluationStore.setState({
        progress: Math.min(1, this.elapsed / 2),
      });
      if (this.elapsed >= 2) {
        const sweep: EvalSweep = {
          finger: view.finger!,
          speed: view.speed!,
          v: view.speed === 'slow' ? settings.slow_v : settings.fast_v,
          points: Array.from({ length: 21 }, (_, i) => ({
            pos: i / 20,
            ma: 100 + i * (view.speed === 'slow' ? 8 : 12),
            excess_ma: i * (view.speed === 'slow' ? 8 : 12),
          })),
          aborted_at: null,
        };
        this.evalSweeps.push(sweep);
        this.elapsed = 0;
        this.evaluationStore.setState({ stage: 'cooldown', progress: 1 });
      }
    } else if (view.stage === 'cooldown' && this.elapsed >= 1) {
      this.evalIndex++;
      this.elapsed = 0;
      if (this.evalIndex < settings.fingers.length * 2)
        this.evaluationStore.setState({
          stage: 'prepare',
          finger: settings.fingers[Math.floor(this.evalIndex / 2)],
          speed: this.evalIndex % 2 ? 'fast' : 'slow',
          progress: 0,
        });
      else {
        const result: EvaluationResult = {
          started_at: this.evalStarted,
          ended_at: new Date().toISOString(),
          settings,
          sweeps: this.evalSweeps,
          fingers: settings.fingers.map((finger) => ({
            finger,
            resistance_slow_ma: 88,
            resistance_fast_ma: 132,
            velocity_dependence_ma: 44,
            peak_excess_ma: 240,
            aborted: false,
          })),
          friction_used: true,
        };
        this.evaluationStore.setState({ stage: 'done', result });
        this.evalSettings = null;
        this.dispose();
        if (this.persist)
          this.queue(() =>
            api.createEvaluation({
              ...result,
              calibration_id: this.calibration.current?.id ?? 1,
              is_demo: true,
            }),
          );
      }
    }
  }
}
