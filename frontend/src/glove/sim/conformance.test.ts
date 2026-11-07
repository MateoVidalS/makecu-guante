import { describe, expect, it } from 'vitest';
import { SimFirmware } from './simFirmware';
import { SimWorld } from './simWorld';
import type { GloveError, GloveEvent, Quint } from '../../contracts/glove';

function controller(sensorPresent = true) {
  const fw = new SimFirmware(sensorPresent);
  const events: GloveEvent[] = [],
    errors: GloveError[] = [];
  fw.events.subscribe((e) => events.push(e));
  fw.errors.subscribe((e) => errors.push(e));
  fw.boot();
  const calibrate = () => {
    for (const i of [0, 1, 2, 3, 4] as const)
      fw.handle({ t: 'calib', i, min: 20, max: 150 }, 0);
  };
  const tick = (from: number, to: number, current = 30) => {
    for (let now = from; now <= to; now += 5) fw.tick(now, current);
  };
  return { fw, events, errors, calibrate, tick };
}
const calibrateWorld = (world: SimWorld) => {
  for (const i of [0, 1, 2, 3, 4] as const) world.glove.calib(i, 20, 150);
};

describe('04-firmware §4 safety conformance', () => {
  it('Never command positions outside [0,1] or angles outside HARD_MIN/HARD_MAX (including mirrored calib)', () => {
    const { fw, calibrate, tick } = controller();
    calibrate();
    fw.handle({ t: 'calib', i: 1, min: 175, max: 5 }, 0);
    fw.handle({ t: 'target', f: [-2, 2, 0.5, 0.5, 0.5], v: 1 }, 0);
    tick(5, 1000);
    expect(fw.position).toEqual([0, 1, 0.5, 0.5, 0.5]);
    expect(fw.angles).toEqual([20, 5, 85, 85, 85]);
    expect(fw.angles.every((a) => a >= 5 && a <= 175)).toBe(true);
  });
  it('Target speed is capped at V_MAX; v ≤ 0 is bad_args', () => {
    const { fw, calibrate, errors } = controller();
    calibrate();
    for (const v of [0, -1, NaN, Infinity])
      fw.handle({ t: 'target', f: [1, 1, 1, 1, 1], v }, 0);
    expect(errors.map((e) => e.why)).toEqual(Array(4).fill('bad_args'));
    fw.handle({ t: 'target', f: [1, 1, 1, 1, 1], v: 5 }, 0);
    fw.tick(500);
    expect(fw.position).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
  });
  it('Follow replaces target and takes up slack at V_FOLLOW', () => {
    const { fw, calibrate } = controller();
    calibrate();
    fw.handle({ t: 'target', f: [1, 1, 1, 1, 1], v: 0.3 }, 0);
    fw.handle({ t: 'follow', f: [0.5, 0.02, 1.5, 1.5, 1.5] }, 0);
    fw.tick(100);
    expect(fw.mode).toBe('follow');
    expect(fw.goal).toEqual([0.45, 0, 1, 1, 1]);
    expect(fw.position[0]).toBeCloseTo(0.15);
  });
  it('Overcurrent releases and latches fault only after 100 ms continuously above limit', () => {
    const { fw, calibrate, events } = controller();
    calibrate();
    fw.handle({ t: 'target', f: [1, 1, 1, 1, 1], v: 1 }, 0);
    fw.tick(5, 8000); // filtered 2000: first sample over limit
    fw.tick(104, 4000);
    expect(fw.state).toBe('run');
    fw.tick(106, 4000);
    expect(fw.state).toBe('fault');
    expect(fw.goal).toEqual([0, 0, 0, 0, 0]);
    expect(events.at(-1)).toMatchObject({ e: 'overcurrent' });
    expect(events.at(-1)!.ma).toBeGreaterThan(1500);
    fw.handle({ t: 'target', f: [1, 1, 1, 1, 1], v: 1 }, 107);
    expect(fw.state).toBe('fault');
    fw.handle({ t: 'release' }, 108);
    expect(fw.state).toBe('idle');
  });
  it('Overcurrent spike below 100 ms resets the continuous-duration counter', () => {
    const { fw, calibrate, tick, events } = controller();
    calibrate();
    fw.handle({ t: 'target', f: [1, 1, 1, 1, 1], v: 1 }, 0);
    tick(5, 55, 2500);
    tick(60, 200, 30);
    expect(events.some((e) => e.e === 'overcurrent')).toBe(false);
    tick(205, 260, 2500);
    expect(fw.state).toBe('run');
  });
  it('STOP releases and latches fault; release cannot clear while held; stop_released does not clear', () => {
    const { fw, calibrate, errors, events, tick } = controller();
    calibrate();
    fw.handle({ t: 'target', f: [1, 1, 1, 1, 1], v: 1 }, 0);
    tick(5, 100);
    fw.setStop(true, 100);
    fw.handle({ t: 'release' }, 105);
    expect(fw.state).toBe('fault');
    expect(errors.at(-1)?.why).toBe('fault');
    for (const cmd of [
      { t: 'target', f: [1, 1, 1, 1, 1] as Quint, v: 1 } as const,
      { t: 'follow', f: [1, 1, 1, 1, 1] as Quint } as const,
      { t: 'jog', i: 1, deg: 90 } as const,
    ])
      fw.handle(cmd, 105);
    expect(errors.slice(-3).every((e) => e.why === 'fault')).toBe(true);
    fw.setStop(false, 110);
    expect(events.at(-1)?.e).toBe('stop_released');
    expect(fw.state).toBe('fault');
    tick(115, 800);
    expect(fw.position).toEqual([0, 0, 0, 0, 0]);
    expect(fw.attached).toEqual([false, false, false, false, false]);
    fw.handle({ t: 'release' }, 805);
    expect(fw.state).toBe('idle');
  });
  it('Watchdog releases and latches fault after >1000 ms in run/calib; idle has no event spam', () => {
    for (const mode of ['target', 'jog'] as const) {
      const { fw, calibrate, events, tick } = controller();
      calibrate();
      fw.handle(
        mode === 'target'
          ? { t: 'target', f: [1, 1, 1, 1, 1], v: 0.3 }
          : { t: 'jog', i: 0, deg: 170 },
        0,
      );
      tick(5, 1000);
      expect(fw.state).not.toBe('fault');
      fw.tick(1005);
      expect(fw.state).toBe('fault');
      expect(events.at(-1)?.e).toBe('watchdog');
    }
    const { fw, events, tick } = controller();
    tick(5, 5000);
    expect(fw.state).toBe('idle');
    expect(events.map((e) => e.e)).toEqual(['boot']);
  });
  it('Any valid message feeds watchdog, including a state-rejected command; bad args do not', () => {
    const { fw, calibrate } = controller();
    calibrate();
    fw.handle({ t: 'target', f: [1, 1, 1, 1, 1], v: 0.3 }, 0);
    fw.handle({ t: 'calib', i: 0, min: 20, max: 150 }, 900);
    fw.tick(1500);
    expect(fw.state).toBe('run');
    fw.handle({ t: 'target', f: [1, 1, 1, 1, 1], v: 0 }, 1800);
    fw.tick(1905);
    expect(fw.state).toBe('fault');
  });
  it('Calib only in idle; jog only in idle/calib; jog absolute angle limits and V_JOG_DEG', () => {
    const { fw, calibrate, errors } = controller();
    calibrate();
    fw.handle({ t: 'jog', i: 0, deg: 175 }, 0);
    fw.tick(500);
    expect(fw.angles[0]).toBe(120);
    fw.handle({ t: 'calib', i: 0, min: 20, max: 150 }, 500);
    expect(errors.at(-1)?.why).toBe('state');
    fw.handle({ t: 'jog', i: 0, deg: 180 }, 500);
    expect(errors.at(-1)?.why).toBe('bad_args');
    fw.handle({ t: 'release' }, 500);
    fw.handle({ t: 'target', f: [1, 1, 1, 1, 1], v: 1 }, 500);
    fw.handle({ t: 'jog', i: 0, deg: 90 }, 500);
    expect(errors.at(-1)?.why).toBe('state');
  });
  it('Calib invalidates a finger until valid; calib_ok only when all five are valid; no_calib blocks target/follow', () => {
    const { fw, errors, events } = controller();
    fw.handle({ t: 'target', f: [1, 1, 1, 1, 1], v: 1 }, 0);
    expect(errors.at(-1)?.why).toBe('no_calib');
    fw.handle({ t: 'follow', f: [1, 1, 1, 1, 1] }, 0);
    expect(errors.at(-1)?.why).toBe('no_calib');
    fw.handle({ t: 'calib', i: 0, min: 20, max: 150 }, 0);
    fw.handle({ t: 'calib', i: 1, min: 20, max: 150 }, 0);
    expect(events.map((e) => e.e)).toEqual(['boot']);
    fw.handle({ t: 'calib', i: 2, min: 20, max: 150 }, 0);
    expect(events.map((e) => e.e)).toEqual(['boot']);
    fw.handle({ t: 'calib', i: 3, min: 20, max: 150 }, 0);
    expect(events.map((e) => e.e)).toEqual(['boot']);
    fw.handle({ t: 'calib', i: 4, min: 20, max: 150 }, 0);
    expect(events.at(-1)?.e).toBe('calib_ok');
    fw.handle({ t: 'calib', i: 1, min: 20, max: 25 }, 0);
    expect(fw.calibration[1]).toBeNull();
    fw.handle({ t: 'follow', f: [1, 1, 1, 1, 1] }, 0);
    expect(errors.at(-1)?.why).toBe('no_calib');
  });
  it('Boot is idle, detached, emits boot + info and never persists calibration', () => {
    const { fw, events } = controller();
    expect(fw.state).toBe('idle');
    expect(fw.attached).toEqual([false, false, false, false, false]);
    expect(events.map((e) => e.e)).toEqual(['boot']);
    expect(fw.info().calib).toEqual([null, null, null, null, null]);
    const infos: unknown[] = [];
    fw.infos.subscribe((info) => infos.push(info));
    fw.handle({ t: 'calib', i: 0, min: 20, max: 150 }, 0);
    fw.boot();
    expect(fw.info().calib).toEqual([null, null, null, null, null]);
    expect(infos).toHaveLength(1);
    expect(new SimFirmware().info().calib).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });
  it('INA missing emits ina_missing and refuses target/follow while permitting jog/release', () => {
    const { fw, events, errors, calibrate } = controller(false);
    calibrate();
    expect(events.some((e) => e.e === 'ina_missing')).toBe(true);
    fw.handle({ t: 'target', f: [1, 1, 1, 1, 1], v: 1 }, 0);
    expect(errors.at(-1)?.why).toBe('state');
    fw.handle({ t: 'follow', f: [1, 1, 1, 1, 1] }, 0);
    expect(errors.at(-1)?.why).toBe('state');
    fw.handle({ t: 'jog', i: 0, deg: 90 }, 0);
    expect(fw.state).toBe('calib');
    fw.handle({ t: 'release' }, 0);
    expect(fw.state).toBe('idle');
  });
  it('Release ramps at V_RELEASE and detaches 500 ms after completing', () => {
    const { fw, calibrate } = controller();
    calibrate();
    fw.handle({ t: 'target', f: [1, 1, 1, 1, 1], v: 1 }, 0);
    fw.tick(1000);
    fw.handle({ t: 'release' }, 1000);
    fw.tick(1100);
    expect(fw.position[0]).toBeCloseTo(0.7);
    fw.tick(1400);
    expect(fw.position).toEqual([0, 0, 0, 0, 0]);
    fw.tick(1899);
    expect(fw.attached).toEqual([true, true, true, true, true]);
    fw.tick(1900);
    expect(fw.attached).toEqual([false, false, false, false, false]);
    fw.handle({ t: 'follow', f: [0.2, 0.2, 0.2, 0.2, 0.2] }, 1900);
    expect(fw.attached).toEqual([true, true, true, true, true]);
  });
  it('Limit is clamped to [100, LIMIT_MAX_MA] and hello returns current config', () => {
    const { fw } = controller();
    fw.handle({ t: 'limit', ma: 1 }, 0);
    expect(fw.info().limit).toBe(100);
    fw.handle({ t: 'limit', ma: 9000 }, 0);
    expect(fw.info().limit).toBe(2200);
    const infos: unknown[] = [];
    fw.infos.subscribe((i) => infos.push(i));
    fw.handle({ t: 'hello' }, 0);
    expect(infos).toEqual([fw.info()]);
  });
});

describe('SimGlove acceptance and timing', () => {
  it('Moderate preset target([1,1,1, 1, 1],0.3) completes in ~3.3 s below 1500 mA', async () => {
    const world = new SimWorld({ autoStart: false });
    await world.glove.connect();
    calibrateWorld(world);
    let peak = 0;
    world.glove.onTelemetry((tel) => {
      peak = Math.max(peak, tel.ma);
    });
    world.glove.target([1, 1, 1, 1, 1], 0.3);
    world.advance(3300);
    expect(world.firmware.position[0]).toBeCloseTo(0.99, 5);
    world.advance(40);
    expect(world.firmware.position).toEqual([1, 1, 1, 1, 1]);
    expect(peak).toBeLessThan(1500);
    expect(world.firmware.state).toBe('run');
  });
  it('Rigid index faults with overcurrent between position 0.25 and 0.4 during target ramp', async () => {
    const world = new SimWorld({ autoStart: false });
    await world.glove.connect();
    calibrateWorld(world);
    world.controls.setRigid('index', true);
    let position: number | null = null;
    world.glove.onEvent((e) => {
      if (e.e === 'overcurrent') position = world.firmware.position[1];
    });
    world.glove.target([1, 1, 1, 1, 1], 0.3);
    world.advance(2000);
    expect(position).toBeGreaterThanOrEqual(0.25);
    expect(position).toBeLessThanOrEqual(0.4);
    expect(world.firmware.state).toBe('fault');
  });
  it('Unplug stops keepalive; firmware watchdog releases even with no browser telemetry or synthetic event', async () => {
    const world = new SimWorld({ autoStart: false });
    await world.glove.connect();
    calibrateWorld(world);
    const events: GloveEvent[] = [],
      firmwareEvents: GloveEvent[] = [];
    world.glove.onEvent((e) => events.push(e));
    world.firmware.events.subscribe((e) => firmwareEvents.push(e));
    world.glove.target([1, 1, 1, 1, 1], 0.3);
    world.advance(100);
    world.controls.unplug();
    world.advance(1000);
    expect(world.glove.connection()).toBe('disconnected');
    expect(world.firmware.state).toBe('fault');
    expect(firmwareEvents.at(-1)?.e).toBe('watchdog');
    expect(events).toEqual([]);
  });
  it('50 Hz telemetry has no drift over ten simulated minutes, including irregular advance calls', async () => {
    const world = new SimWorld({ autoStart: false });
    await world.glove.connect();
    let count = 0,
      last = 0;
    world.glove.onTelemetry((tel) => {
      expect(tel.ms - last).toBe(20);
      last = tel.ms;
      count++;
    });
    for (let i = 0; i < 6000; i++) {
      world.advance(17);
      world.advance(83);
    }
    expect(world.now).toBe(600000);
    expect(last).toBe(600000);
    expect(count).toBe(30000);
  });
});
