import { createStore } from 'zustand/vanilla';
import * as api from '../api/client';
import type {
  Runtime,
  ExerciseView,
  EvaluationView,
  Unsubscribe,
} from '../contracts/runtime';
import type { Calibration, FrictionCurve } from '../contracts/calibration';
import type { EngineEvent, ExerciseSettings } from '../contracts/engine';
import {
  GLOVE_FINGERS,
  type GloveFinger,
  type GloveTelemetry,
} from '../contracts/glove';
import { POSES, calibratedPinch } from '../contracts/poses';
import type { createGloveController } from '../glove/GloveProvider';
import type { createVisionController } from '../vision/VisionProvider';
import {
  createExerciseEngine,
  createEvaluationEngine,
  frictionRun,
  type FrictionEngine,
  type Output,
} from '../engine';
import {
  PersistenceQueue,
  type RuntimeApi,
  type QueueStorage,
} from './persistence';

type GloveController = ReturnType<typeof createGloveController>;
type VisionController = ReturnType<typeof createVisionController>;
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
const calibrationKey = 'rehab.runtime.calibration.v1';
export interface RuntimeOptions {
  glove: GloveController;
  vision: VisionController;
  api?: RuntimeApi;
  storage?: QueueStorage;
  now?: () => number;
  onSaved?: () => void;
}

/** One real-time loop shared by the UI, voice, simulator and hardware transports. */
export class RehabRuntime implements Runtime {
  readonly exerciseStore = createStore<ExerciseView>(initialExercise);
  readonly evaluationStore = createStore<EvaluationView>(initialEvaluation);
  readonly diagnosticsStore = createStore<{
    visionToCommandP95: number | null;
    commandToEchoP95: number | null;
    samples: number;
  }>(() => ({ visionToCommandP95: null, commandToEchoP95: null, samples: 0 }));
  readonly persistence: PersistenceQueue;
  private exerciseEngine;
  private evaluationEngine;
  private friction: FrictionEngine | null = null;
  private finishFriction:
    ((value: Partial<Record<GloveFinger, FrictionCurve[]>>) => void) | null =
    null;
  private mode: 'exercise' | 'evaluation' | 'friction' | null = null;
  private listeners = new Set<(event: EngineEvent) => void>();
  private detach: Unsubscribe[] = [];
  private clientDetach: Unsubscribe[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private sessionKey = '';
  private settings: ExerciseSettings | null = null;
  private runCalibration: Calibration | null = null;
  private keyCounter = 0;
  private visionLatencies: number[] = [];
  private echoLatencies: number[] = [];
  private echo: { at: number; mode: 'target' | 'follow'; f: number[] } | null =
    null;
  private ticking = false;
  private pendingTick = false;
  private mounted = false;
  private readonly clock: () => number;
  constructor(private readonly options: RuntimeOptions) {
    this.clock =
      options.now ??
      (() =>
        options.glove.client.kind === 'sim' ||
        options.vision.source.kind === 'sim'
          ? options.glove.world.timestamp()
          : performance.now());
    const epoch = Date.now() - this.clock();
    const engineOptions = {
      timestamp: (now: number) => new Date(epoch + now).toISOString(),
    };
    this.exerciseEngine = createExerciseEngine(engineOptions);
    this.evaluationEngine = createEvaluationEngine(engineOptions);
    this.persistence = new PersistenceQueue(
      options.api ?? api,
      options.storage,
      (key, id) => {
        if (key === this.sessionKey)
          this.exerciseStore.setState({ sessionId: id });
      },
      options.onSaved,
    );
    try {
      const saved = options.storage?.getItem(calibrationKey);
      if (saved) this.calibration.current = JSON.parse(saved) as Calibration;
    } catch {
      /* A missing cache must never supply invented hardware calibration. */
    }
    this.sources = {
      get glove() {
        return options.glove.client.kind;
      },
      get vision() {
        return options.vision.source.kind;
      },
      setGlove: async (kind) => {
        this.requireIdle();
        await options.glove.setKind(kind);
      },
      setVision: async (kind) => {
        this.requireIdle();
        await options.vision.setKind(kind);
      },
    };
  }
  readonly sources: Runtime['sources'];
  calibration: Runtime['calibration'] = {
    current: null,
    reload: async () => {
      this.requireIdle();
      this.setCalibration(await api.getLatestCalibration());
    },
    save: async (value) => {
      this.requireIdle();
      const saved = await api.createCalibration(value);
      this.setCalibration(saved);
      return saved;
    },
    sendToGlove: async () => {
      this.sendCalibration();
    },
  };
  private setCalibration(value: Calibration | null) {
    this.calibration.current = value;
    this.options.vision.setCalibration(value?.camera ?? null);
    try {
      this.options.storage?.setItem(calibrationKey, JSON.stringify(value));
    } catch {
      /* Session queue exposes storage failures separately. */
    }
    this.sendCalibration();
  }
  private sendCalibration() {
    const c = this.calibration.current,
      client = this.options.glove.client;
    if (!c || client.connection() !== 'connected') return;
    client.release();
    for (const [i, finger] of GLOVE_FINGERS.entries()) {
      const servo = c.servo.find((s) => s.finger === finger);
      if (!servo) throw new Error(`Missing ${finger} servo calibration`);
      client.calib(i as 0 | 1 | 2, servo.min_deg, servo.max_deg);
    }
    client.limit(
      this.mode === 'evaluation' || this.mode === 'friction'
        ? (this.evaluationStore.getState().result?.settings.limit_ma ?? 600)
        : c.current_limit_ma,
    );
  }
  private requireIdle() {
    if (this.mode)
      throw new Error(
        'End the current session before changing sources or calibration',
      );
  }
  private requireReady() {
    this.requireIdle();
    if (!this.calibration.current)
      throw new Error('Calibrate the glove and camera first');
    if (this.options.glove.client.connection() !== 'connected')
      throw new Error('Connect the glove first');
    return structuredClone(this.calibration.current);
  }
  exercise: Runtime['exercise'] = {
    start: async (plan, settings) => {
      const calibration = this.requireReady();
      if (!plan.length) throw new Error('Choose at least one pose');
      const out = this.exerciseEngine.start(
        plan,
        settings,
        calibration,
        this.clock(),
      );
      this.mode = 'exercise';
      this.runCalibration = calibration;
      this.settings = settings;
      this.sessionKey = `${Date.now()}-${++this.keyCounter}-${Math.random()}`;
      this.exerciseStore.setState(initialExercise(), true);
      this.persistence.enqueue({
        kind: 'session',
        key: this.sessionKey,
        value: {
          mode: 'exercise',
          plan,
          settings,
          calibration_id: calibration.id,
          is_demo:
            this.sources.glove === 'sim' || this.sources.vision === 'sim',
        },
      });
      this.handle(out);
    },
    pause: () => {
      if (this.mode === 'exercise')
        this.handle(this.exerciseEngine.pause(this.clock()));
    },
    resume: () => {
      if (this.mode === 'exercise')
        this.handle(this.exerciseEngine.resume(this.clock()));
    },
    skip: () => {
      if (this.mode === 'exercise')
        this.handle(this.exerciseEngine.skip(this.clock()));
    },
    stop: async () => {
      if (this.mode === 'exercise')
        this.handle(this.exerciseEngine.stop(this.clock()));
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
      const calibration = this.requireReady();
      if (!settings.fingers.length)
        throw new Error('Choose at least one finger');
      const out = this.evaluationEngine.start(
        settings,
        calibration,
        this.clock(),
      );
      this.runCalibration = calibration;
      this.mode = 'evaluation';
      this.options.glove.world.setIntent('open', 'DONE');
      this.handle(out);
    },
    stop: async () => {
      if (this.mode === 'evaluation' || this.mode === 'friction')
        this.handle(
          (this.friction ?? this.evaluationEngine).stop(this.clock()),
        );
    },
    view: () => this.evaluationStore.getState(),
    subscribe: (cb) => this.evaluationStore.subscribe(cb),
    runFriction: async (fingers) => {
      const calibration = this.requireReady();
      if (!fingers.length) throw new Error('Choose at least one finger');
      this.friction = frictionRun({
        timestamp: () => new Date().toISOString(),
      });
      this.runCalibration = calibration;
      this.mode = 'friction';
      const result = new Promise<Partial<Record<GloveFinger, FrictionCurve[]>>>(
        (resolve) => {
          this.finishFriction = resolve;
        },
      );
      this.handle(
        this.friction.start(
          { slow_v: 0.2, fast_v: 1, limit_ma: 600, fingers },
          calibration,
          this.clock(),
        ),
      );
      return result;
    },
  };
  mount() {
    if (this.mounted) return;
    this.mounted = true;
    this.options.vision.setCalibration(
      this.calibration.current?.camera ?? null,
    );
    const bind = () => {
      this.clientDetach.forEach((f) => f());
      const client = this.options.glove.client;
      this.echo = null;
      this.clientDetach = [
        client.onTelemetry((tel) => {
          this.observeEcho(tel);
          this.tick();
        }),
        client.onEvent((event) => {
          if (event.e === 'boot' && this.calibration.current)
            this.sendCalibration();
          this.tick([event]);
        }),
        client.onConnection((connection) => {
          if (connection === 'connected') this.sendCalibration();
          this.tick();
        }),
      ];
      if (client.connection() === 'connected') this.sendCalibration();
    };
    bind();
    this.detach = [
      this.options.vision.subscribe(() => this.tick()),
      this.options.glove.store.subscribe((s, p) => {
        if (s.client !== p.client) bind();
      }),
    ];
    this.timer = setInterval(() => {
      this.tick();
      void this.persistence.flush();
    }, 100);
    void this.persistence.flush();
    void this.calibration.reload().catch(() => {
      /* Cached calibration supports sessions during backend outages. */
    });
  }
  tick(
    events: Parameters<typeof this.exerciseEngine.tick>[0]['gloveEvents'] = [],
  ) {
    if (!this.mode) return;
    // Simulator release can synchronously emit events. Defer nested ticks until output is applied.
    if (this.ticking) {
      this.pendingTick = true;
      return;
    }
    this.ticking = true;
    try {
      const input = {
        now: this.clock(),
        vision: this.options.vision.latest,
        tel: this.options.glove.client.latest(),
        gloveEvents: events,
        gloveConnected: this.options.glove.client.connection() === 'connected',
      };
      this.handle(
        (this.mode === 'exercise'
          ? this.exerciseEngine
          : (this.friction ?? this.evaluationEngine)
        ).tick(input),
      );
    } finally {
      this.ticking = false;
    }
    if (this.pendingTick) {
      this.pendingTick = false;
      this.tick();
    }
  }
  private handle(out: Output) {
    for (const command of out.commands) {
      const client = this.options.glove.client;
      if (command.t === 'target' || command.t === 'follow') {
        const frame = this.options.vision.latest;
        if (frame) this.sample(this.visionLatencies, this.clock() - frame.t);
        // Keep the oldest unacknowledged command; high frame rates must not reset its clock.
        this.echo ??= {
          at: performance.now(),
          mode: command.t,
          f: [...command.f],
        };
        if (command.t === 'target') client.target(command.f, command.v);
        else client.follow(command.f);
      } else if (command.t === 'release') {
        this.echo = null;
        client.release();
      } else client.limit(command.ma);
    }
    for (const event of out.events) {
      if (event.kind === 'phase' && this.sources.vision === 'sim')
        this.options.glove.world.setIntent(event.pose, event.phase);
      if (event.kind === 'phase' && event.phase === 'PRESENT')
        this.exerciseStore.setState({ activeMax: {} });
      if (event.kind === 'progress')
        this.exerciseStore.setState((s) => ({
          activeMax: { ...s.activeMax, [event.finger]: event.active_max },
        }));
      if (event.kind === 'attempt_done') {
        this.exerciseStore.setState({ lastResult: event.result });
        this.persistence.enqueue({
          kind: 'attempt',
          key: this.sessionKey,
          value: event.result,
        });
      }
      if (event.kind === 'session_done') {
        this.exerciseStore.setState({ summary: event.summary });
        this.persistence.enqueue({
          kind: 'end',
          key: this.sessionKey,
          value: event.summary,
        });
      }
      this.publishViews();
      this.listeners.forEach((cb) => cb(event));
    }
    this.publishViews();
    if (
      this.mode === 'exercise' &&
      this.exerciseEngine.state().phase === 'DONE'
    )
      this.mode = null;
    if (this.mode === 'evaluation' || this.mode === 'friction') {
      const view = (this.friction ?? this.evaluationEngine).state();
      if (view.result) {
        if (this.mode === 'evaluation')
          this.persistence.enqueue({
            kind: 'evaluation',
            value: {
              ...view.result,
              calibration_id: this.runCalibration!.id,
              is_demo:
                this.sources.glove === 'sim' || this.sources.vision === 'sim',
            },
          });
        else this.finishFriction?.(this.friction!.curves());
        this.finishFriction = null;
        this.friction = null;
        this.mode = null;
      }
    }
  }
  private publishViews() {
    if (this.mode === 'exercise') {
      const state = this.exerciseEngine.state(),
        settings = this.settings!;
      const duration = {
        PRESENT: settings.present_s,
        ATTEMPT: settings.attempt_s,
        HOLD: settings.hold_s,
        ASSIST: settings.assist_max_s,
        ASSIST_HOLD: settings.hold_s,
        RELEASE: 0.5,
        REST: settings.rest_s,
        PAUSED: null,
        DONE: null,
      }[state.phase];
      this.exerciseStore.setState({
        ...state,
        pose:
          state.pose === 'pinch'
            ? calibratedPinch(this.runCalibration!.camera.pinch_closed)
            : POSES[state.pose],
        phaseDuration: duration,
        paused: state.phase === 'PAUSED',
        assisting: state.phase === 'ASSIST' || state.phase === 'ASSIST_HOLD',
      });
    } else if (this.mode)
      this.evaluationStore.setState(
        (this.friction ?? this.evaluationEngine).state(),
        true,
      );
  }
  private sample(values: number[], value: number) {
    if (!Number.isFinite(value) || value < 0) return;
    values.push(value);
    if (values.length > 256) values.shift();
    const p95 = (data: number[]) =>
      data.length
        ? [...data].sort((a, b) => a - b)[Math.ceil(data.length * 0.95) - 1]
        : null;
    this.diagnosticsStore.setState({
      visionToCommandP95: p95(this.visionLatencies),
      commandToEchoP95: p95(this.echoLatencies),
      samples: this.visionLatencies.length + this.echoLatencies.length,
    });
  }
  private observeEcho(tel: GloveTelemetry) {
    const pending = this.echo;
    if (!pending) return;
    const goal =
      pending.mode === 'follow'
        ? pending.f.map((f) => Math.max(0, f - 0.05))
        : pending.f;
    if (
      tel.md === pending.mode &&
      tel.tg?.every((f, i) => Math.abs(f - goal[i]) < 0.025)
    ) {
      this.sample(this.echoLatencies, performance.now() - pending.at);
      this.echo = null;
    } else if (performance.now() - pending.at > 2000) this.echo = null;
  }
  dispose() {
    this.mounted = false;
    if (this.mode === 'exercise')
      this.handle(this.exerciseEngine.stop(this.clock()));
    else if (this.mode)
      this.handle((this.friction ?? this.evaluationEngine).stop(this.clock()));
    this.detach.forEach((f) => f());
    this.clientDetach.forEach((f) => f());
    this.detach = [];
    this.clientDetach = [];
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
