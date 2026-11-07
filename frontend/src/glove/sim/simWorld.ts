import type { ExercisePhase } from '../../contracts/engine';
import type { PoseId } from '../../contracts/poses';
import {
  GLOVE_FINGERS,
  type GloveFinger,
  type Quint,
} from '../../contracts/glove';
import { Signal } from '../clientBase';
import { FW, SimFirmware } from './simFirmware';
import { SimPatient, type PatientPreset } from './patient';
import { SimGlove } from './simGlove';
import { SimVision } from './simVision';
import { SERVO_PROFILES } from './servoProfiles';
import { supplyPower, type SimPower } from './power';

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
  private clockOrigin = performance.now();
  get origin() {
    return this.clockOrigin;
  }
  now = 0;
  handHiddenUntil = 0;
  /** Physical shafts may stall while firmware telemetry continues its commanded ramp. */
  servoPosition: Quint = [0, 0, 0, 0, 0];
  power: SimPower = supplyPower([0, 0, 0, 0, 0]);
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
    // A world can be created long before the user selects the simulator.
    this.clockOrigin = Math.max(this.clockOrigin, this.wallStart - this.now);
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
      const before: Quint = [...f.position];
      const beforeAngles: Quint = [...f.angles];
      const ranges = f.calibration.map((c) =>
        c ? Math.abs(c[1] - c[0]) : FW.HARD_MAX - FW.HARD_MIN,
      ) as Quint;
      this.power = supplyPower(
        this.patient.servoCurrents(
          f.position,
          this.lastVelocity,
          this.random,
          f.attached,
          ranges,
        ),
      );
      f.tick(this.now, this.power.totalMa);
      this.servoPosition = this.servoPosition.map((position, i) => {
        const profile = SERVO_PROFILES[GLOVE_FINGERS[i]];
        let goal = f.position[i];
        if (!f.attached[i]) return 0;
        if (goal > position) {
          // Model the current-limited supply as loss of closing torque. A rigid
          // finger stalls its own servo; unwinding remains possible for release.
          if (
            this.power.saturated ||
            this.power.perServoMa[i] >= profile.stall_ma
          )
            return position;
          if (this.patient.rigid[GLOVE_FINGERS[i]]) goal = Math.min(goal, 0.22);
        }
        const step = ((profile.max_speed_deg_s / ranges[i]) * tickMs) / 1000;
        return position + Math.max(-step, Math.min(step, goal - position));
      }) as Quint;
      this.lastVelocity = f.position.map(
        (p, i) => (p - before[i]) / (tickMs / 1000),
      ) as Quint;
      // Jog has no normalized velocity before calibration; account for its moving servo.
      if (f.mode === 'jog')
        this.lastVelocity = f.angles.map(
          (a, i) =>
            (a - beforeAngles[i]) /
            (FW.HARD_MAX - FW.HARD_MIN) /
            (tickMs / 1000),
        ) as Quint;
      if (this.tickIndex % (FW.CONTROL_HZ / FW.TEL_HZ) === 0)
        this.telemetry.emit(this.now);
      if (this.now + 1e-8 >= this.nextCamera) {
        this.camera.emit(this.now);
        this.nextCamera += 1000 / 30;
      }
      this.vision.deliver(this.now);
    }
  }
  private lastVelocity: Quint = [0, 0, 0, 0, 0];
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.glove.disconnect();
    this.vision.stop();
  }
}
export const createSimWorld = (options?: SimWorldOptions) =>
  new SimWorld(options);
