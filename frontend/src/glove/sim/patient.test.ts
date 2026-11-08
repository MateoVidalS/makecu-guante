import { describe, expect, it } from 'vitest';
import {
  GLOVE_FINGERS,
  closureFromPull,
  type Quint,
} from '../../contracts/glove';
import { PATIENT_PRESETS, PATIENT_PRESET_OPTIONS, SimPatient } from './patient';
import { SERVO_PROFILES } from './servoProfiles';

const quiet = () => 0.5;
const zeros: Quint = [0, 0, 0, 0, 0];

describe('opening-only patient physics', () => {
  it.each(PATIENT_PRESET_OPTIONS)(
    '$id reacts into its active range and relaxes to rest',
    ({ id }) => {
      const patient = new SimPatient(id);
      const profile = PATIENT_PRESETS[id];
      expect(patient.position).toEqual(profile.rest);
      patient.setIntent('full_fist', 'ATTEMPT', 0, quiet);
      patient.tick(395, 0.395);
      expect(patient.position).toEqual(profile.rest);
      patient.tick(400, 2);
      expect(patient.position).toEqual([
        Math.max(0.7, profile.active_min[0]),
        0.95,
        0.95,
        0.95,
        0.95,
      ]);
      patient.setIntent('open', 'ATTEMPT', 400, quiet);
      patient.tick(800, 2);
      for (let i = 0; i < 5; i++)
        expect(patient.position[i]).toBeCloseTo(
          Math.max(profile.active_min[i], patient.rigidFloor(GLOVE_FINGERS[i])),
        );
      patient.setIntent('open', 'ASSIST', 800, quiet);
      const intent = [...patient.position];
      patient.tick(1000, 2);
      for (let i = 0; i < 5; i++)
        expect(patient.position[i]).toBeCloseTo(intent[i]);
      patient.setIntent('open', 'RELEASE', 1000, quiet);
      patient.tick(1000, 2);
      expect(patient.position).toEqual(profile.rest);
    },
  );
  it('pull only lowers closure and slack restores the patient posture or intent', () => {
    const patient = new SimPatient();
    for (let pull = 0; pull <= 1; pull += 0.05) {
      const real = patient.realPosition(Array(5).fill(pull) as Quint, quiet);
      for (const closure of real) {
        expect(closure).toBeLessThanOrEqual(0.75);
        expect(closure).toBeCloseTo(Math.min(0.75, closureFromPull(pull)));
      }
    }
    expect(patient.realPosition(zeros, quiet)).toEqual(patient.position);
    patient.setIntent('open', 'ATTEMPT', 0, quiet);
    patient.tick(400, 2);
    expect(patient.realPosition(zeros, quiet)).toEqual([
      0.55, 0.55, 0.55, 0.55, 0.55,
    ]);
  });
  it('demo opens completely alone, with no tone even when held by the glove', () => {
    const patient = new SimPatient('demo');
    patient.setIntent('open', 'ATTEMPT', 0, quiet);
    patient.tick(400, 2);
    expect(patient.position).toEqual(zeros);
    expect(
      patient.servoCurrents([0.95, 0.95, 0.95, 0.95, 0.95], zeros, quiet),
    ).toEqual(GLOVE_FINGERS.map((f) => SERVO_PROFILES[f].idle_ma));
  });
  it('sustained tone remains at zero velocity and returns to idle at slack', () => {
    const patient = new SimPatient('spastic');
    const loose = patient.servoCurrents(zeros, zeros, quiet);
    const half = patient.servoCurrents([0.5, 0.5, 0.5, 0.5, 0.5], zeros, quiet);
    const held = patient.servoCurrents(
      [0.95, 0.95, 0.95, 0.95, 0.95],
      zeros,
      quiet,
    );
    for (let i = 0; i < 5; i++) {
      expect(loose[i]).toBe(SERVO_PROFILES[GLOVE_FINGERS[i]].idle_ma);
      expect(half[i]).toBeGreaterThan(loose[i]);
      expect(held[i] - loose[i]).toBeCloseTo(0.8 * 550);
    }
    expect(patient.servoCurrents(zeros, zeros, quiet)).toEqual(loose);
  });
  it('velocity-dependent stretch reflex starts above threshold only with a taut tendon', () => {
    const patient = new SimPatient('spastic');
    const pull: Quint = [0.6, 0, 0, 0, 0];
    const held = patient.servoCurrents(pull, zeros, quiet)[0];
    const threshold = patient.servoCurrents(pull, [0.15, 0, 0, 0, 0], quiet)[0];
    const fast = patient.servoCurrents(pull, [0.5, 0, 0, 0, 0], quiet)[0];
    const servo = SERVO_PROFILES.thumb;
    const moving = (v: number) =>
      (servo.moving_ma - servo.idle_ma) *
      (0.25 + (0.75 * v * 170) / servo.max_speed_deg_s);
    expect(threshold - held).toBeCloseTo(moving(0.15));
    expect(fast - held - moving(0.5)).toBeCloseTo(400 * (0.5 - 0.15) * 0.45);
    const slackFast = patient.servoCurrents(zeros, [0.5, 0, 0, 0, 0], quiet)[0];
    expect(slackFast).toBeCloseTo(servo.idle_ma + moving(0.5));
  });
  it('rigid_index respects its closure floor, draws stall current beyond it, and can be toggled', () => {
    const patient = new SimPatient('rigid_index');
    expect(patient.rigid.index).toBe(true);
    for (const noise of [() => 0, quiet, () => 1])
      expect(
        patient.realPosition([0.95, 0.95, 0.95, 0.95, 0.95], noise)[1],
      ).toBeGreaterThanOrEqual(0.6);
    expect(patient.servoCurrents([0, 0.6, 0, 0, 0], zeros, quiet)[1]).toBe(
      SERVO_PROFILES.index.stall_ma,
    );
    patient.rigid.index = false;
    expect(patient.realPosition([0, 0.95, 0, 0, 0], quiet)[1]).toBeCloseTo(
      0.05,
    );
  });
  it('preset selection resets resting posture, intent and rigidity; severe stays an alias', () => {
    const patient = new SimPatient('rigid_index');
    patient.setPreset('demo');
    patient.tick(1000, 1);
    expect(patient.position).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
    expect(patient.rigid.index).toBe(false);
    expect(PATIENT_PRESETS.severe).toBe(PATIENT_PRESETS.spastic);
    expect(PATIENT_PRESET_OPTIONS.map((p) => p.id)).toEqual([
      'demo',
      'mild',
      'moderate',
      'spastic',
      'rigid_index',
    ]);
  });
});
