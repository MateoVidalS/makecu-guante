import { describe, expect, it } from 'vitest';
import {
  GLOVE_FINGERS,
  type GloveEvent,
  type Quint,
} from '../../contracts/glove';
import { SimPatient } from './patient';
import { ELECTRONICS_IDLE_MA, SUPPLY_LIMIT_MA, supplyPower } from './power';
import { SERVO_PROFILES } from './servoProfiles';
import { SimWorld } from './simWorld';

const quiet = () => 0.5;
const zeros: Quint = [0, 0, 0, 0, 0];

describe('five-servo power model', () => {
  it('sums per-servo demand, then saturates the 2.5 A supply instead of hiding overload', () => {
    const patient = new SimPatient();
    for (const finger of GLOVE_FINGERS) patient.rigid[finger] = true;
    const currents = patient.servoCurrents([1, 1, 1, 1, 1], zeros, quiet);
    expect(currents).toEqual([650, 800, 750, 650, 650]);
    const power = supplyPower(currents);
    expect(power.demandMa).toBe(3530);
    expect(power.demandMa).toBeGreaterThan(2200);
    expect(power.totalMa).toBe(SUPPLY_LIMIT_MA);
    expect(power.saturated).toBe(true);
  });
  it('sums distinct moving currents and load, with no current for detached servos', () => {
    const patient = new SimPatient();
    const velocity: Quint = [0.3, 0.3, 0.3, 0.3, 0.3];
    const currents = patient.servoCurrents(zeros, velocity, quiet);
    expect(currents[1]).toBeGreaterThan(currents[2]);
    expect(currents[2]).toBeGreaterThan(currents[3]);
    expect(currents[3]).toBe(currents[4]);
    const power = supplyPower(currents);
    expect(power.totalMa).toBe(
      ELECTRONICS_IDLE_MA + currents.reduce((a, b) => a + b, 0),
    );
    expect(power.saturated).toBe(false);
    expect(
      patient.servoCurrents(zeros, velocity, quiet, [
        false,
        false,
        false,
        false,
        false,
      ]),
    ).toEqual(zeros);
  });
  it('unwinding a rigid hand unloads the tendon instead of drawing five stall currents', () => {
    const patient = new SimPatient('severe');
    for (const finger of GLOVE_FINGERS) patient.rigid[finger] = true;
    const position: Quint = [1, 1, 1, 1, 1];
    const closing = supplyPower(
      patient.servoCurrents(position, [0.3, 0.3, 0.3, 0.3, 0.3], quiet),
    );
    const releasing = supplyPower(
      patient.servoCurrents(position, [-3, -3, -3, -3, -3], quiet),
    );
    expect(closing.saturated).toBe(true);
    expect(releasing.saturated).toBe(false);
    expect(releasing.demandMa).toBeLessThan(1500);
  });
  it.each(GLOVE_FINGERS)(
    'rigidity can stall %s independently, including while holding position',
    (finger) => {
      const patient = new SimPatient();
      patient.rigid[finger] = true;
      const positions: Quint = [0.5, 0.5, 0.5, 0.5, 0.5];
      const currents = patient.servoCurrents(positions, zeros, quiet);
      const i = GLOVE_FINGERS.indexOf(finger);
      expect(currents[i]).toBe(SERVO_PROFILES[finger].stall_ma);
      expect(
        currents.filter(
          (ma, j) => ma === SERVO_PROFILES[GLOVE_FINGERS[j]].stall_ma,
        ),
      ).toHaveLength(1);
      expect(patient.realPosition(positions, quiet)[i]).toBe(0.22);
    },
  );
  it('physical shafts respect per-servo mechanical speed while telemetry keeps the firmware ramp', async () => {
    const world = new SimWorld({ autoStart: false });
    await world.glove.connect();
    for (const i of [0, 1, 2, 3, 4] as const) world.glove.calib(i, 5, 175);
    world.glove.target([1, 1, 1, 1, 1], 1);
    world.advance(1000);
    world.glove.release();
    world.advance(100);
    expect(world.firmware.position[0]).toBeCloseTo(0.7);
    // The unidentified thumb's provisional 300 deg/s is slower than a 3/s
    // release across 170 degrees. Other servos can follow that release ramp.
    expect(world.servoPosition[0]).toBeCloseTo(1 - (300 / 170) * 0.1);
    expect(world.servoPosition[1]).toBeCloseTo(0.7);
    expect(world.servoPosition[0]).toBeGreaterThan(world.firmware.position[0]);
  });
  it('supply saturation stalls physical closure and still trips the independent 100 ms firmware rule', async () => {
    const world = new SimWorld({ autoStart: false });
    await world.glove.connect();
    for (const i of [0, 1, 2, 3, 4] as const) {
      world.glove.calib(i, 20, 150);
      world.controls.setRigid(GLOVE_FINGERS[i], true);
    }
    world.glove.limit(2200);
    world.glove.target([1, 1, 1, 1, 1], 0.3);
    // Start at an already-loaded commanded position to time continuous overload.
    world.firmware.position = [0.5, 0.5, 0.5, 0.5, 0.5];
    const events: GloveEvent[] = [];
    world.firmware.events.subscribe((event) => events.push(event));
    let overAt: number | undefined;
    while (world.firmware.state !== 'fault' && world.now < 200) {
      world.advance(5);
      if (world.firmware.currentMa > 2200) overAt ??= world.now;
      expect(world.power.saturated).toBe(true);
      expect(world.power.totalMa).toBe(SUPPLY_LIMIT_MA);
      expect(world.servoPosition).toEqual(zeros);
    }
    expect(overAt).toBeDefined();
    expect(world.firmware.state).toBe('fault');
    const event = events.find((event) => event.e === 'overcurrent')!;
    expect(event.ma).toBeGreaterThan(2200);
    expect(event.t - overAt!).toBeGreaterThanOrEqual(100);
    expect(event.t - overAt!).toBeLessThanOrEqual(105);
    expect(world.firmware.goal).toEqual(zeros);
    world.advance(1000);
    expect(world.firmware.attached).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(world.power.demandMa).toBe(ELECTRONICS_IDLE_MA);
  });
  it.each(['mild', 'moderate', 'severe'] as const)(
    '%s normal five-finger assist never saturates the supply',
    async (preset) => {
      const world = new SimWorld({ autoStart: false, preset });
      await world.glove.connect();
      for (const i of [0, 1, 2, 3, 4] as const) world.glove.calib(i, 20, 150);
      world.glove.limit(2200);
      world.setIntent('full_fist', 'ATTEMPT');
      world.advance(3000);
      world.glove.target([0.95, 0.95, 0.95, 0.95, 0.95], 0.3);
      for (let i = 0; i < 800; i++) {
        world.advance(5);
        expect(world.power.demandMa).toBeLessThan(2200);
        expect(world.power.saturated).toBe(false);
      }
      expect(world.firmware.state).toBe('run');
      expect(world.servoPosition).toEqual([0.95, 0.95, 0.95, 0.95, 0.95]);
    },
  );
});
