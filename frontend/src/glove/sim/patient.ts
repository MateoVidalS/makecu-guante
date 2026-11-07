import {
  GLOVE_FINGERS,
  type GloveFinger,
  type Triple,
} from '../../contracts/glove';
import { POSES, type PoseId } from '../../contracts/poses';
import type { ExercisePhase } from '../../contracts/engine';
import { clamp } from './simFirmware';

export type PatientPreset = 'mild' | 'moderate' | 'severe';
export const PATIENT_PRESETS = {
  mild: {
    active_max: [0.8, 0.75, 0.85] as Triple,
    active_speed: 0.6,
    reaction_s: 0.4,
    stiffness: { k0: 80, kv: 60 },
  },
  moderate: {
    active_max: [0.5, 0.4, 0.6] as Triple,
    active_speed: 0.6,
    reaction_s: 0.4,
    stiffness: { k0: 130, kv: 100 },
  },
  severe: {
    active_max: [0.25, 0.2, 0.3] as Triple,
    active_speed: 0.6,
    reaction_s: 0.4,
    stiffness: { k0: 200, kv: 150 },
  },
};
export class SimPatient {
  position: Triple = [0, 0, 0];
  readonly rigid: Record<GloveFinger, boolean> = {
    thumb: false,
    index: false,
    middle: false,
  };
  private desired: Triple = [0, 0, 0];
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
      ) as Triple;
      this.reactAt = now + PATIENT_PRESETS[this.preset].reaction_s * 1000;
    } else if (['REST', 'RELEASE', 'DONE', 'PAUSED'].includes(phase)) {
      this.desired = [0, 0, 0];
      this.reactAt = now;
    }
  }
  tick(now: number, dt: number) {
    if (now < this.reactAt) return;
    const amount = PATIENT_PRESETS[this.preset].active_speed * dt;
    this.position = this.position.map((p, i) =>
      clamp(p + clamp(this.desired[i] - p, -amount, amount)),
    ) as Triple;
  }
  realPosition(servo: Triple, random: () => number): Triple {
    return servo.map((p, i) =>
      clamp(
        (this.rigid[GLOVE_FINGERS[i]]
          ? Math.min(0.22, Math.max(p, this.position[i]))
          : Math.max(p, this.position[i])) +
          (random() - 0.5) * 0.02,
      ),
    ) as Triple;
  }
  current(servo: Triple, velocity: Triple, random: () => number) {
    const {
      active_max,
      stiffness: { k0, kv },
    } = PATIENT_PRESETS[this.preset];
    return (
      30 +
      servo.reduce(
        (ma, pos, i) =>
          ma +
          (Math.abs(velocity[i]) > 0.00001 ? 120 : 0) +
          (k0 + kv * Math.abs(velocity[i])) * Math.max(0, pos - active_max[i]) +
          (this.rigid[GLOVE_FINGERS[i]] ? 12000 * Math.max(0, pos - 0.22) : 0),
        0,
      ) +
      (random() - 0.5) * 6
    );
  }
}
