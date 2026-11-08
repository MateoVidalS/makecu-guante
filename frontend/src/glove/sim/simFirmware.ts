import type {
  FirmwareMode,
  FirmwareState,
  GloveEvent,
  GloveInfo,
  GloveTelemetry,
  SerialCommand,
  Quint,
} from '../../contracts/glove';
import { Signal } from '../clientBase';
import type { GloveError } from '../../contracts/glove';

// Frozen contract §2.4. Keep these explicit so conformance can be mirrored in C++.
export const FW = Object.freeze({
  HARD_MIN: 5,
  HARD_MAX: 175,
  V_MAX: 1,
  V_FOLLOW: 1.5,
  V_RELEASE: 3,
  V_JOG_DEG: 60,
  FOLLOW_SLACK: 0.08,
  LIMIT_DEFAULT_MA: 1500,
  LIMIT_MAX_MA: 2200,
  OVERCURRENT_MS: 100,
  WATCHDOG_MS: 1000,
  TEL_HZ: 50,
  CONTROL_HZ: 200,
});
export const clamp = (n: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, n));
const move = (a: number, b: number, amount: number) =>
  a + clamp(b - a, -amount, amount);
const finite = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);

export class SimFirmware {
  state: FirmwareState = 'idle';
  mode: FirmwareMode = 'none';
  position: Quint = [0, 0, 0, 0, 0];
  goal: Quint = [0, 0, 0, 0, 0];
  angles: Quint = [90, 90, 90, 90, 90];
  attached = [false, false, false, false, false];
  calibration: ([number, number] | null)[] = [null, null, null, null, null];
  currentLimit: number = FW.LIMIT_DEFAULT_MA;
  currentMa = 0;
  readonly events = new Signal<GloveEvent>();
  readonly errors = new Signal<GloveError>();
  readonly infos = new Signal<GloveInfo>();
  private lastMessage = 0;
  private stopHeld = false;
  private overSince: number | null = null;
  private peak = 0;
  private previousCurrent = 0;
  private speed = 0;
  private jogIndex: number | null = null;
  private jogGoal = 90;
  private releasedAt: number | null = 0;
  private lastTick = 0;

  constructor(readonly sensorPresent = true) {}
  boot(now = 0) {
    this.state = 'idle';
    this.mode = 'none';
    this.position = [0, 0, 0, 0, 0];
    this.goal = [0, 0, 0, 0, 0];
    this.angles = [90, 90, 90, 90, 90];
    this.attached.fill(false);
    this.calibration = [null, null, null, null, null];
    this.currentLimit = FW.LIMIT_DEFAULT_MA;
    this.currentMa = 0;
    this.previousCurrent = 0;
    this.overSince = null;
    this.peak = 0;
    this.speed = 0;
    this.jogIndex = null;
    this.releasedAt = now;
    this.lastMessage = now;
    this.lastTick = now;
    this.events.emit({ t: now, e: 'boot' });
    if (this.stopHeld) this.fault('stop_button', now);
    if (!this.sensorPresent) this.events.emit({ t: now, e: 'ina_missing' });
    this.infos.emit(this.info());
  }
  info(): GloveInfo {
    return {
      fw: '0.1.0-sim',
      fingers: 5,
      limit: this.currentLimit,
      calib: this.calibration.map((c) => (c ? [...c] : null)),
    };
  }
  telemetry(now: number): GloveTelemetry {
    return {
      t: now,
      ms: now,
      a: [...this.position],
      tg: [...this.goal],
      ma: this.currentMa,
      st: this.state,
      md: this.mode,
    };
  }
  private error(c: string, why: string, now: number) {
    this.errors.emit({ t: now, c, why });
  }
  handle(cmd: SerialCommand, now: number) {
    // Validate at this boundary too: callers can be untyped JS or malformed wire input.
    const bad = () => this.error(cmd.t, 'bad_args', now);
    if (cmd.t === 'target' || cmd.t === 'follow') {
      if (
        !Array.isArray(cmd.f) ||
        cmd.f.length !== 5 ||
        !cmd.f.every(finite) ||
        (cmd.t === 'target' && (!finite(cmd.v) || cmd.v <= 0))
      )
        return bad();
    } else if (cmd.t === 'calib') {
      if (
        !Number.isInteger(cmd.i) ||
        cmd.i < 0 ||
        cmd.i > 4 ||
        !finite(cmd.min) ||
        !finite(cmd.max) ||
        cmd.min < FW.HARD_MIN ||
        cmd.min > FW.HARD_MAX ||
        cmd.max < FW.HARD_MIN ||
        cmd.max > FW.HARD_MAX ||
        Math.abs(cmd.max - cmd.min) < 20
      ) {
        if (
          this.state === 'idle' &&
          Number.isInteger(cmd.i) &&
          cmd.i >= 0 &&
          cmd.i < 5
        )
          this.calibration[cmd.i] = null;
        return bad();
      }
    } else if (cmd.t === 'jog') {
      if (
        !Number.isInteger(cmd.i) ||
        cmd.i < 0 ||
        cmd.i > 4 ||
        !finite(cmd.deg) ||
        cmd.deg < FW.HARD_MIN ||
        cmd.deg > FW.HARD_MAX
      )
        return bad();
    } else if (cmd.t === 'limit') {
      if (!finite(cmd.ma)) return bad();
    } else if (!['release', 'ping', 'hello'].includes(cmd.t)) {
      return this.error(cmd.t, 'unknown_type', now);
    }
    this.lastMessage = now;
    if (cmd.t === 'release') {
      if (this.stopHeld) return this.error(cmd.t, 'fault', now);
      this.unwind();
      this.state = 'idle';
      return;
    }
    if (cmd.t === 'hello') {
      this.infos.emit(this.info());
      return;
    }
    if (cmd.t === 'ping') return;
    if (cmd.t === 'limit') {
      this.currentLimit = clamp(cmd.ma, 100, FW.LIMIT_MAX_MA);
      return;
    }
    if (this.state === 'fault') return this.error(cmd.t, 'fault', now);
    if (cmd.t === 'calib') {
      if (this.state !== 'idle') return this.error(cmd.t, 'state', now);
      this.calibration[cmd.i] = [cmd.min, cmd.max];
      if (this.calibration.every(Boolean))
        this.events.emit({ t: now, e: 'calib_ok' });
      return;
    }
    if (cmd.t === 'jog') {
      if (this.state !== 'idle' && this.state !== 'calib')
        return this.error(cmd.t, 'state', now);
      this.state = 'calib';
      this.mode = 'jog';
      this.jogIndex = cmd.i;
      this.jogGoal = cmd.deg;
      this.attached[cmd.i] = true;
      this.releasedAt = null;
      return;
    }
    if (this.state !== 'idle' && this.state !== 'run')
      return this.error(cmd.t, 'state', now);
    if (!this.sensorPresent) return this.error(cmd.t, 'state', now);
    if (!this.calibration.every(Boolean))
      return this.error(cmd.t, 'no_calib', now);
    this.state = 'run';
    this.mode = cmd.t;
    this.goal = cmd.f.map((f) =>
      clamp(cmd.t === 'follow' ? f - FW.FOLLOW_SLACK : f),
    ) as Quint;
    this.speed = cmd.t === 'follow' ? FW.V_FOLLOW : Math.min(cmd.v, FW.V_MAX);
    this.jogIndex = null;
    // Power only servos that pull (firmware safety.cpp): an unpowered spool is as slack
    // as pull 0. A powered servo stays powered and unwinds; release detaches all.
    this.goal.forEach((g, i) => {
      if (g > 0) this.attached[i] = true;
    });
    this.releasedAt = null;
  }
  private unwind() {
    this.goal = [0, 0, 0, 0, 0];
    this.mode = 'none';
    this.speed = FW.V_RELEASE;
    this.jogIndex = null;
    this.releasedAt = null;
    this.overSince = null;
    this.peak = 0;
  }
  private fault(e: 'overcurrent' | 'stop_button' | 'watchdog', now: number) {
    if (this.state === 'fault') return;
    const ma = this.peak;
    this.unwind();
    this.state = 'fault';
    this.events.emit({ t: now, e, ...(e === 'overcurrent' ? { ma } : {}) });
  }
  setStop(held: boolean, now: number) {
    if (held === this.stopHeld) return;
    this.stopHeld = held;
    if (held) this.fault('stop_button', now);
    else this.events.emit({ t: now, e: 'stop_released' });
  }
  tick(now: number, rawCurrentMa = 30) {
    // Match the native controller: missed deadlines cannot cause a catch-up jump.
    const dt =
      Math.min(1000 / FW.CONTROL_HZ, Math.max(0, now - this.lastTick)) / 1000;
    this.lastTick = now;
    const median = (rawCurrentMa + this.previousCurrent) / 2;
    this.previousCurrent = rawCurrentMa;
    this.currentMa += 0.5 * (median - this.currentMa);
    if (this.currentMa > this.currentLimit && this.state !== 'fault') {
      this.overSince ??= now;
      this.peak = Math.max(this.peak, this.currentMa);
      if (now - this.overSince >= FW.OVERCURRENT_MS)
        this.fault('overcurrent', now);
    } else {
      this.overSince = null;
      this.peak = 0;
    }
    if (
      (this.state === 'run' || this.state === 'calib') &&
      now - this.lastMessage > FW.WATCHDOG_MS
    )
      this.fault('watchdog', now);
    if (this.mode === 'jog' && this.jogIndex !== null) {
      const i = this.jogIndex;
      this.angles[i] = clamp(
        move(this.angles[i], this.jogGoal, FW.V_JOG_DEG * dt),
        FW.HARD_MIN,
        FW.HARD_MAX,
      );
      const c = this.calibration[i];
      if (c) this.position[i] = clamp((this.angles[i] - c[0]) / (c[1] - c[0]));
    } else {
      for (let i = 0; i < 5; i++) {
        this.position[i] = clamp(
          move(
            this.position[i],
            this.goal[i],
            (this.state === 'run' && this.goal[i] < this.position[i]
              ? FW.V_RELEASE
              : this.speed) * dt,
          ),
        );
        const c = this.calibration[i];
        if (c)
          this.angles[i] = clamp(
            c[0] + this.position[i] * (c[1] - c[0]),
            FW.HARD_MIN,
            FW.HARD_MAX,
          );
        // No calibration exists after a jog: unwind toward the hard minimum.
        else if (this.attached[i])
          this.angles[i] = move(
            this.angles[i],
            FW.HARD_MIN,
            FW.V_RELEASE * (FW.HARD_MAX - FW.HARD_MIN) * dt,
          );
      }
    }
    if (
      this.mode === 'none' &&
      this.position.every((v) => v === 0) &&
      this.angles.every(
        (v, i) =>
          !!this.calibration[i] || !this.attached[i] || v === FW.HARD_MIN,
      )
    ) {
      this.releasedAt ??= now;
      if (now - this.releasedAt >= 500) this.attached.fill(false);
    }
  }
}
