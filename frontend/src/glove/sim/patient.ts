import {
  GLOVE_FINGERS,
  type GloveFinger,
  type Quint,
} from '../../contracts/glove';
import { POSES, type PoseId } from '../../contracts/poses';
import type { ExercisePhase } from '../../contracts/engine';
import { clamp } from './simFirmware';
import { SERVO_PROFILES } from './servoProfiles';
import { supplyPower } from './power';

export type PatientPreset = 'mild' | 'moderate' | 'severe';
export const PATIENT_PRESETS = {
  mild: {
    active_max: [0.8, 0.75, 0.85, 0.65, 0.6] as Quint,
    active_speed: 0.6,
    reaction_s: 0.4,
    stiffness: { k0: 80, kv: 60 },
  },
  moderate: {
    active_max: [0.5, 0.4, 0.6, 0.35, 0.3] as Quint,
    active_speed: 0.6,
    reaction_s: 0.4,
    stiffness: { k0: 130, kv: 100 },
  },
  severe: {
    active_max: [0.25, 0.2, 0.3, 0.15, 0.1] as Quint,
    active_speed: 0.6,
    reaction_s: 0.4,
    stiffness: { k0: 200, kv: 150 },
  },
};
export class SimPatient {
  position: Quint = [0, 0, 0, 0, 0];
  readonly rigid: Record<GloveFinger, boolean> = {
    thumb: false,
    index: false,
    middle: false,
    ring: false,
    pinky: false,
  };
  private desired: Quint = [0, 0, 0, 0, 0];
  private reactAt = 0;
  constructor(public preset: PatientPreset = 'moderate') {}
  setPreset(preset: PatientPreset) {
    this.preset = preset;
  }
  setIntent(
    pose: PoseId,
    phase: ExercisePhase,
    now: number,
    random: () => number,
  ) {
    if (phase === 'PRESENT' || phase === 'ATTEMPT') {
      const def = POSES[pose];
      this.desired = GLOVE_FINGERS.map((f, i) =>
        Math.min(
          def.closure[f] ?? this.position[i],
          clamp(
            PATIENT_PRESETS[this.preset].active_max[i] +
              (random() - 0.5) * 0.04,
          ),
        ),
      ) as Quint;
      this.reactAt = now + PATIENT_PRESETS[this.preset].reaction_s * 1000;
    } else if (['REST', 'RELEASE', 'DONE', 'PAUSED'].includes(phase)) {
      this.desired = [0, 0, 0, 0, 0];
      this.reactAt = now;
    }
  }
  tick(now: number, dt: number) {
    if (now < this.reactAt) return;
    const amount = PATIENT_PRESETS[this.preset].active_speed * dt;
    this.position = this.position.map((p, i) =>
      clamp(p + clamp(this.desired[i] - p, -amount, amount)),
    ) as Quint;
  }
  realPosition(servo: Quint, random: () => number): Quint {
    return servo.map((p, i) =>
      clamp(
        (this.rigid[GLOVE_FINGERS[i]]
          ? Math.min(0.22, Math.max(p, this.position[i]))
          : Math.max(p, this.position[i])) +
          (random() - 0.5) * 0.02,
      ),
    ) as Quint;
  }
  servoCurrents(
    servo: Quint,
    velocity: Quint,
    random: () => number,
    attached: readonly boolean[] = [true, true, true, true, true],
    rangeDegrees: Quint = [170, 170, 170, 170, 170],
  ): Quint {
    const {
      active_max,
      stiffness: { k0, kv },
    } = PATIENT_PRESETS[this.preset];
    return servo.map((pos, i) => {
      if (!attached[i]) return 0;
      const profile = SERVO_PROFILES[GLOVE_FINGERS[i]];
      const speed = Math.abs(velocity[i]);
      // Slow closing ramps still pay tendon/guide friction (25% duty); the
      // rest scales with mechanical speed. Unwinding slack needs less torque.
      const moving =
        speed > 0.00001
          ? (profile.moving_ma - profile.idle_ma) *
            (0.25 +
              0.75 *
                clamp((speed * rangeDegrees[i]) / profile.max_speed_deg_s)) *
            (velocity[i] < 0 ? 0.5 : 1)
          : 0;
      // Tendons pull only closed: unwinding unloads the hand rather than
      // magnifying resistance by the faster safety-release velocity.
      const load =
        velocity[i] < -0.00001
          ? 0
          : (k0 + kv * speed) * Math.max(0, pos - active_max[i]) +
            (this.rigid[GLOVE_FINGERS[i]]
              ? 12000 * Math.max(0, pos - 0.22)
              : 0);
      return clamp(
        profile.idle_ma + moving + load + (random() - 0.5) * 6,
        0,
        profile.stall_ma,
      );
    }) as Quint;
  }
  current(servo: Quint, velocity: Quint, random: () => number) {
    return supplyPower(this.servoCurrents(servo, velocity, random)).totalMa;
  }
}
