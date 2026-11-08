import { describe, expect, it } from 'vitest';
import {
  GLOVE_FINGERS,
  pullFromClosure,
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
    expect(currents).toEqual([650, 650, 650, 650, 650]);
    const power = supplyPower(currents);
    expect(power.demandMa).toBe(3280);
    expect(power.demandMa).toBeGreaterThan(2200);
    expect(power.totalMa).toBe(SUPPLY_LIMIT_MA);
    expect(power.saturated).toBe(true);
  });
  it('sums equal moving currents for the five identical servos, with no current for detached servos', () => {
    const patient = new SimPatient();
    const velocity: Quint = [0.3, 0.3, 0.3, 0.3, 0.3];
    const currents = patient.servoCurrents(zeros, velocity, quiet);
    expect(currents[0]).toBeGreaterThan(0);
    expect(currents.every((ma) => ma === currents[0])).toBe(true);
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
    const winding = supplyPower(
      patient.servoCurrents(position, [0.3, 0.3, 0.3, 0.3, 0.3], quiet),
    );
    const releasing = supplyPower(
      patient.servoCurrents(position, [-3, -3, -3, -3, -3], quiet),
    );
    expect(winding.saturated).toBe(true);
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
      expect(patient.realPosition(positions, quiet)[i]).toBe(0.6);
    },
  );
  it('five spastic fingers held at pull 0.95 demand 2305 mA without a governor', () => {
    const patient = new SimPatient('spastic');
    const power = supplyPower(
      patient.servoCurrents([0.95, 0.95, 0.95, 0.95, 0.95], zeros, quiet),
    );
    for (let i = 0; i < 5; i++) expect(power.perServoMa[i]).toBeCloseTo(455);
    expect(power.demandMa).toBeCloseTo(2305);
    expect(power.totalMa).toBeGreaterThan(2200);
    expect(power.saturated).toBe(false);
  });
  it('the same held opening on demo draws 105 mA, below 1500 mA', () => {
    const patient = new SimPatient('demo');
    const power = supplyPower(
      patient.servoCurrents([0.95, 0.95, 0.95, 0.95, 0.95], zeros, quiet),
    );
    expect(power.totalMa).toBe(105);
    expect(power.totalMa).toBeLessThan(1500);
  });
  it('spastic opening without a governor trips the firmware 2200 mA cut and releases to slack', async () => {
    const world = new SimWorld({ autoStart: false, preset: 'spastic' });
    await world.glove.connect();
    for (const i of [0, 1, 2, 3, 4] as const) world.glove.calib(i, 20, 150);
    world.glove.limit(2200);
    const events: GloveEvent[] = [];
    world.glove.onEvent((e) => events.push(e));
    world.glove.target([0.95, 0.95, 0.95, 0.95, 0.95], 0.2);
    world.advance(6000);
    expect(events).toContainEqual(
      expect.objectContaining({ e: 'overcurrent' }),
    );
    expect(world.firmware.state).toBe('fault');
    expect(world.firmware.position).toEqual(zeros);
    expect(world.servoPosition).toEqual(zeros);
    expect(world.power.totalMa).toBe(30);
  });
  it('a fast fist while following pays out without stall or overcurrent', async () => {
    const world = new SimWorld({ autoStart: false, preset: 'spastic' });
    await world.glove.connect();
    for (const i of [0, 1, 2, 3, 4] as const) world.glove.calib(i, 20, 150);
    world.glove.limit(900);
    world.glove.follow([0.98, 0.98, 0.98, 0.98, 0.98]);
    world.firmware.position = [0.9, 0.9, 0.9, 0.9, 0.9];
    world.servoPosition = [...world.firmware.position];
    world.patient.position = [0.1, 0.1, 0.1, 0.1, 0.1];
    // A strong voluntary fist closes at 2/s, faster than the 1.5/s winding cap.
    // Feed its measured closure every 20 ms, as the follow caller would.
    for (let step = 1; step <= 20; step++) {
      const closure = 0.1 + step * 0.04;
      world.patient.position.fill(closure);
      world.glove.follow(Array(5).fill(pullFromClosure(closure)) as Quint);
      world.advance(20);
      expect(world.firmware.state).toBe('run');
      for (let i = 0; i < 5; i++)
        expect(world.power.perServoMa[i]).toBeLessThan(
          SERVO_PROFILES[GLOVE_FINGERS[i]].stall_ma,
        );
      expect(world.power.totalMa).toBeLessThan(900);
      expect(world.firmware.position[1]).toBeLessThanOrEqual(
        pullFromClosure(closure),
      );
    }
  });
  it('a rigid floor stops the physical shaft while commanded pull continues', async () => {
    const world = new SimWorld({ autoStart: false, preset: 'rigid_index' });
    await world.glove.connect();
    for (const i of [0, 1, 2, 3, 4] as const) world.glove.calib(i, 20, 150);
    world.glove.limit(2200);
    world.glove.target([0, 0.8, 0, 0, 0], 0.2);
    world.advance(4000);
    expect(world.firmware.position[1]).toBeCloseTo(0.8);
    expect(world.servoPosition[1]).toBeCloseTo(pullFromClosure(0.6));
    expect(world.power.perServoMa[1]).toBe(SERVO_PROFILES.index.stall_ma);
    world.glove.release();
    world.advance(1000);
    expect(world.servoPosition).toEqual(zeros);
    expect(world.power.totalMa).toBe(30);
  });
  it.each(['target', 'follow'] as const)(
    '%s unwinding cannot wind a shaft that is behind commanded pull',
    async (mode) => {
      const world = new SimWorld({ autoStart: false });
      await world.glove.connect();
      for (const i of [0, 1, 2, 3, 4] as const) world.glove.calib(i, 20, 150);
      world.glove.target([0.9, 0, 0, 0, 0], 0.2);
      // The shaft lagged during an earlier stall. Dropping the pull goal must
      // not make it catch up in the opening direction as the load disappears.
      world.firmware.position[0] = 0.9;
      world.servoPosition[0] = 0.4;
      if (mode === 'target') world.glove.target([0.1, 0, 0, 0, 0], 0.2);
      else world.glove.follow([0.18, 0, 0, 0, 0]);
      let before = world.servoPosition[0];
      for (let i = 0; i < 60; i++) {
        world.advance(5);
        expect(world.servoPosition[0]).toBeLessThanOrEqual(before);
        before = world.servoPosition[0];
      }
      expect(world.servoPosition[0]).toBeCloseTo(0.1);
    },
  );
  it('a servo with insufficient torque stalls even without a rigid floor', async () => {
    const world = new SimWorld({ autoStart: false, preset: 'spastic' });
    await world.glove.connect();
    for (const i of [0, 1, 2, 3, 4] as const) world.glove.calib(i, 20, 150);
    world.glove.target([0.95, 0, 0, 0, 0], 1);
    // Observe during the fast ramp; the velocity catch vanishes once it stops.
    world.advance(900);
    expect(world.patient.rigid.thumb).toBe(false);
    expect(world.power.perServoMa[0]).toBe(SERVO_PROFILES.thumb.stall_ma);
    expect(world.servoPosition[0]).toBeLessThan(world.firmware.position[0]);
    expect(world.firmware.state).toBe('run');
  });
  it('physical shafts respect per-servo mechanical speed while telemetry keeps the firmware ramp', async () => {
    const world = new SimWorld({ autoStart: false, preset: 'demo' });
    await world.glove.connect();
    for (const i of [0, 1, 2, 3, 4] as const) world.glove.calib(i, 5, 175);
    world.glove.target([1, 1, 1, 1, 1], 1);
    world.advance(1000);
    world.glove.release();
    world.advance(100);
    expect(world.firmware.position[0]).toBeCloseTo(0.7);
    // The S51's provisional 500 deg/s is just slower than a 3/s release across
    // 170 degrees (510 deg/s): the shafts lag the firmware ramp slightly.
    for (const i of [0, 1, 2, 3, 4])
      expect(world.servoPosition[i]).toBeCloseTo(1 - (500 / 170) * 0.1);
    expect(world.servoPosition[0]).toBeGreaterThan(world.firmware.position[0]);
  });
  it('supply saturation stalls physical winding and still trips the independent 100 ms firmware rule', async () => {
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
    for (let i = 0; i < 200; i++) {
      world.advance(5);
      expect(world.servoPosition).toEqual(zeros);
    }
    expect(world.firmware.attached).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(world.power.demandMa).toBe(ELECTRONICS_IDLE_MA);
  });
  it.each(['demo', 'mild', 'moderate'] as const)(
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
