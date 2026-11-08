import {
  GLOVE_FINGERS,
  closureFromPull,
  type GloveFinger,
  type Quint,
} from '../../contracts/glove';
import { POSES, type PoseId } from '../../contracts/poses';
import type { ExercisePhase } from '../../contracts/engine';
import { clamp } from './simFirmware';
import { SERVO_PROFILES } from './servoProfiles';
import { supplyPower } from './power';

export type OpeningPatientPreset =
  'demo' | 'mild' | 'moderate' | 'spastic' | 'rigid_index';
/** `severe` is a compatibility alias for callers predating the opening glove. */
export type PatientPreset = OpeningPatientPreset | 'severe';
export interface PatientProfile {
  label: string;
  rest: Quint;
  active_min: Quint;
  active_max: Quint;
  active_speed: number;
  reaction_s: number;
  tone_ma_per_unit: Quint;
  reflex_ma_per_unit_speed: Quint;
  reflex_threshold: number;
  rigid_floor?: Partial<Record<GloveFinger, number>>;
}
const quint = (value: number): Quint => [value, value, value, value, value];
const profile = (
  label: string,
  rest: number,
  activeMin: number,
  tone: number,
  reflex: number,
): PatientProfile => ({
  label,
  rest: quint(rest),
  active_min: quint(activeMin),
  active_max: quint(1),
  active_speed: 0.6,
  reaction_s: 0.4,
  tone_ma_per_unit: quint(tone),
  reflex_ma_per_unit_speed: quint(reflex),
  reflex_threshold: 0.15,
});
const spastic = profile('Spastic', 0.85, 0.75, 550, 400);
const moderate = profile('Moderate', 0.75, 0.55, 220, 100);
export const PATIENT_PRESETS: Record<PatientPreset, PatientProfile> = {
  demo: profile('Demo (no tone)', 0.2, 0, 0, 0),
  mild: profile('Mild', 0.6, 0.3, 100, 40),
  moderate,
  spastic,
  rigid_index: {
    ...moderate,
    label: 'Rigid index',
    rigid_floor: { index: 0.6 },
  },
  severe: spastic,
};
/** Stable picker ids; the legacy alias deliberately does not add a sixth option. */
export const PATIENT_PRESET_OPTIONS = (
  ['demo', 'mild', 'moderate', 'spastic', 'rigid_index'] as const
).map((id) => ({ id, label: PATIENT_PRESETS[id].label }));

export class SimPatient {
  /** Closure of the patient's own hand with no tendon load. */
  position: Quint;
  readonly rigid: Record<GloveFinger, boolean> = {
    thumb: false,
    index: false,
    middle: false,
    ring: false,
    pinky: false,
  };
  private desired: Quint;
  private reactAt = 0;
  constructor(public preset: PatientPreset = 'moderate') {
    this.position = [...PATIENT_PRESETS[preset].rest];
    this.desired = [...this.position];
    this.resetRigidity();
  }
  private resetRigidity() {
    for (const finger of GLOVE_FINGERS)
      this.rigid[finger] =
        PATIENT_PRESETS[this.preset].rigid_floor?.[finger] !== undefined;
  }
  rigidFloor(finger: GloveFinger): number {
    return this.rigid[finger]
      ? (PATIENT_PRESETS[this.preset].rigid_floor?.[finger] ?? 0.6)
      : 0;
  }
  setPreset(preset: PatientPreset) {
    this.preset = preset;
    this.resetRigidity();
    this.position = [...PATIENT_PRESETS[preset].rest];
    this.desired = [...this.position];
    this.reactAt = 0;
  }
  setIntent(
    pose: PoseId,
    phase: ExercisePhase,
    now: number,
    random: () => number,
  ) {
    const p = PATIENT_PRESETS[this.preset];
    if (phase === 'PRESENT' || phase === 'ATTEMPT') {
      this.desired = GLOVE_FINGERS.map((finger, i) => {
        const target = POSES[pose].closure[finger];
        return target === null
          ? p.rest[i]
          : clamp(
              target + (random() - 0.5) * 0.04,
              Math.max(p.active_min[i], this.rigidFloor(finger)),
              p.active_max[i],
            );
      }) as Quint;
      this.reactAt = now + p.reaction_s * 1000;
    } else if (['REST', 'RELEASE', 'DONE', 'PAUSED'].includes(phase)) {
      this.desired = [...p.rest];
      this.reactAt = now;
    }
    // HOLD/ASSIST/ASSIST_HOLD preserve the patient's voluntary effort.
  }
  tick(now: number, dt: number) {
    if (now < this.reactAt) return;
    const amount = PATIENT_PRESETS[this.preset].active_speed * dt;
    this.position = this.position.map((p, i) =>
      clamp(
        p + clamp(this.desired[i] - p, -amount, amount),
        this.rigidFloor(GLOVE_FINGERS[i]),
        1,
      ),
    ) as Quint;
  }
  private closure(pull: number, i: number) {
    return Math.max(
      this.rigidFloor(GLOVE_FINGERS[i]),
      Math.min(this.position[i], closureFromPull(pull)),
    );
  }
  realPosition(pull: Quint, random: () => number): Quint {
    return pull.map((p, i) =>
      clamp(
        this.closure(p, i) + (random() - 0.5) * 0.02,
        this.rigidFloor(GLOVE_FINGERS[i]),
        1,
      ),
    ) as Quint;
  }
  servoCurrents(
    pull: Quint,
    velocity: Quint,
    random: () => number,
    attached: readonly boolean[] = [true, true, true, true, true],
    rangeDegrees: Quint = [170, 170, 170, 170, 170],
  ): Quint {
    const p = PATIENT_PRESETS[this.preset];
    return pull.map((pos, i) => {
      if (!attached[i]) return 0;
      const servo = SERVO_PROFILES[GLOVE_FINGERS[i]];
      const unwinding = velocity[i] < -0.00001;
      const speed = Math.abs(velocity[i]);
      const moving =
        speed > 0.00001
          ? (servo.moving_ma - servo.idle_ma) *
            (0.25 +
              0.75 * clamp((speed * rangeDegrees[i]) / servo.max_speed_deg_s)) *
            (unwinding ? 0.5 : 1)
          : 0;
      const real = this.closure(pos, i);
      const stretch = Math.max(0, this.position[i] - real);
      // Positive pull speed stretches flexors only when the tendon is loaded.
      // A held opening keeps its tone load at zero speed. Paying out unloads.
      const tone = p.tone_ma_per_unit[i] * stretch;
      const reflex =
        p.reflex_ma_per_unit_speed[i] *
        Math.max(0, velocity[i] - p.reflex_threshold) *
        stretch;
      const blocked = Math.max(
        0,
        this.rigidFloor(GLOVE_FINGERS[i]) - closureFromPull(pos),
      );
      const load = unwinding ? 0 : tone + reflex + 12000 * blocked;
      // Torque demand beyond the servo's capacity draws stall current. SimWorld
      // then stops its physical shaft while commanded telemetry can continue.
      return clamp(
        servo.idle_ma + moving + load + (random() - 0.5) * 6,
        0,
        servo.stall_ma,
      );
    }) as Quint;
  }
  current(pull: Quint, velocity: Quint, random: () => number) {
    return supplyPower(this.servoCurrents(pull, velocity, random)).totalMa;
  }
}
