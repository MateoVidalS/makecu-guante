import type { ExercisePhase } from '../../contracts/engine';
import type { PoseId } from '../../contracts/poses';
import type { GloveFinger, Triple } from '../../contracts/glove';
import { Signal } from '../clientBase';
import { FW, SimFirmware } from './simFirmware';
import { SimPatient, type PatientPreset } from './patient';
import { SimGlove } from './simGlove';
import { SimVision } from './simVision';

export interface SimWorldOptions {
  seed?: number;
  preset?: PatientPreset;
  timeScale?: number;
  autoStart?: boolean;
  sensorPresent?: boolean;
}
export class SimWorld {
  readonly firmware: SimFirmware;
  readonly patient: SimPatient;
  readonly glove: SimGlove;
  readonly vision: SimVision;
  readonly ticks = new Signal<number>();
  readonly telemetry = new Signal<number>();
  readonly camera = new Signal<number>();
  readonly origin = performance.now();
  now = 0;
  handHiddenUntil = 0;
  readonly timeScale: number;
  private randomState: number;
  private tickIndex = 0;
  private nextCamera = 1000 / 30;
  private requestedTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private wallStart = 0;
  private simStart = 0;
  private readonly autoStart: boolean;
  readonly controls = {
    pressStop: () => this.firmware.setStop(true, this.now),
    releaseStop: () => this.firmware.setStop(false, this.now),
    unplug: () => this.glove.unplug(),
    setRigid: (finger: GloveFinger, rigid: boolean) => {
      this.patient.rigid[finger] = rigid;
    },
    handOutOfFrame: (ms: number) => {
      this.handHiddenUntil = this.now + Math.max(0, ms);
    },
    setPreset: (preset: PatientPreset) => this.patient.setPreset(preset),
  };
  constructor(options: SimWorldOptions = {}) {
    this.timeScale = options.timeScale ?? 1;
    if (!Number.isFinite(this.timeScale) || this.timeScale <= 0)
      throw new Error('timeScale must be positive');
    this.autoStart = options.autoStart ?? true;
    this.randomState = (options.seed ?? 42) >>> 0;
    this.firmware = new SimFirmware(options.sensorPresent ?? true);
    this.patient = new SimPatient(options.preset);
    this.glove = new SimGlove(this);
    this.vision = new SimVision(this);
  }
  random = () => {
    this.randomState =
      (Math.imul(1664525, this.randomState) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  };
  timestamp = () => this.origin + this.now;
  setIntent(pose: PoseId, phase: ExercisePhase) {
    this.patient.setIntent(pose, phase, this.now, this.random);
  }
  start() {
    if (!this.autoStart || this.timer) return;
    this.wallStart = performance.now();
    this.simStart = this.requestedTime;
    this.timer = setInterval(() => {
      const due =
        this.simStart + (performance.now() - this.wallStart) * this.timeScale;
      this.advance(Math.max(0, due - this.requestedTime));
    }, 5);
  }
  /** Advance a fixed-step clock. Deadlines derive from tick indices, never timer arrival time. */
  advance(ms: number) {
    if (!Number.isFinite(ms) || ms < 0)
      throw new Error('advance requires nonnegative finite milliseconds');
    this.requestedTime += ms;
    const tickMs = 1000 / FW.CONTROL_HZ;
    while ((this.tickIndex + 1) * tickMs <= this.requestedTime + 1e-8) {
      this.now = ++this.tickIndex * tickMs;
      this.ticks.emit(this.now);
      this.patient.tick(this.now, tickMs / 1000);
      const f = this.firmware;
      // Use the actual ramp velocity (including requested target speed), not just the cap.
      const before: Triple = [...f.position];
      const beforeAngles: Triple = [...f.angles];
      f.tick(
        this.now,
        this.patient.current(f.position, this.lastVelocity, this.random),
      );
      this.lastVelocity = f.position.map(
        (p, i) => (p - before[i]) / (tickMs / 1000),
      ) as Triple;
      // Jog has no normalized velocity before calibration; account for its moving servo.
      if (f.mode === 'jog')
        this.lastVelocity = f.angles.map(
          (a, i) =>
            (a - beforeAngles[i]) /
            (FW.HARD_MAX - FW.HARD_MIN) /
            (tickMs / 1000),
        ) as Triple;
      if (this.tickIndex % (FW.CONTROL_HZ / FW.TEL_HZ) === 0)
        this.telemetry.emit(this.now);
      if (this.now + 1e-8 >= this.nextCamera) {
        this.camera.emit(this.now);
        this.nextCamera += 1000 / 30;
      }
      this.vision.deliver(this.now);
    }
  }
  private lastVelocity: Triple = [0, 0, 0];
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.glove.disconnect();
    this.vision.stop();
  }
}
export const createSimWorld = (options?: SimWorldOptions) =>
  new SimWorld(options);
