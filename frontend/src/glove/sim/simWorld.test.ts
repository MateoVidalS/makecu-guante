import {
  CURRENT_CAMERA_VIEW,
  CURRENT_FLEX_MODEL,
} from '../../contracts/calibration';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimWorld } from './simWorld';
import { PATIENT_PRESETS } from './patient';
import { pullFromClosure } from '../../contracts/glove';
import type { VisionFrame } from '../../contracts/vision';
import type { CameraCalibration } from '../../contracts/calibration';

const zeros = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
const calibration: CameraCalibration = {
  affected_hand: 'left',
  camera_view: CURRENT_CAMERA_VIEW,
  flex_model: CURRENT_FLEX_MODEL,
  open_flex: zeros,
  closed_flex: { thumb: 100, index: 270, middle: 270, ring: 270, pinky: 270 },
  pinch_closed: 0.1,
  pinch_open: 1,
};
afterEach(() => vi.useRealTimers());

describe('SimWorld patient and camera', () => {
  it.each(['mild', 'moderate', 'severe'] as const)(
    '%s patient reacts after 0.4 s, reaches the active range, then relaxes on RELEASE',
    async (preset) => {
      const world = new SimWorld({ preset, autoStart: false });
      world.setIntent('full_fist', 'PRESENT');
      world.advance(395);
      expect(world.patient.position).toEqual(PATIENT_PRESETS[preset].rest);
      world.advance(2000);
      for (let i = 0; i < 5; i++)
        expect(world.patient.position[i]).toBeCloseTo(
          Math.max(
            [0.7, 0.95, 0.95, 0.95, 0.95][i],
            PATIENT_PRESETS[preset].active_min[i],
          ),
          1,
        );
      world.setIntent('full_fist', 'ASSIST');
      world.advance(2000);
      expect(world.patient.position[1]).toBeGreaterThan(0.1);
      world.setIntent('open', 'RELEASE');
      world.advance(2000);
      expect(world.patient.position).toEqual(PATIENT_PRESETS[preset].rest);
    },
  );
  it('seeded runs reproduce current, tremor and vision with independent world instances', async () => {
    const run = async (seed: number) => {
      const world = new SimWorld({ seed, autoStart: false });
      await world.glove.connect();
      await world.vision.start({ affectedHand: 'left' });
      world.vision.setCalibration(calibration);
      world.setIntent('full_fist', 'ATTEMPT');
      world.advance(2000);
      return {
        tel: world.glove.latest()?.ma,
        closure: world.vision.latest()?.closure,
        patient: world.patient.position,
      };
    };
    expect(await run(8)).toEqual(await run(8));
    expect(await run(8)).not.toEqual(await run(9));
  });
  it('camera runs at 30 Hz with 60 ms latency, calibrated closure/joints and affected handedness', async () => {
    const world = new SimWorld({ autoStart: false });
    const frames: VisionFrame[] = [];
    world.vision.onFrame((frame) => {
      expect(world.timestamp() - frame.t).toBeCloseTo(60, 6);
      frames.push(frame);
    });
    await world.vision.start({ affectedHand: 'left' });
    world.vision.setCalibration(calibration);
    world.setIntent('full_fist', 'ATTEMPT');
    world.advance(90);
    expect(frames).toHaveLength(0);
    world.advance(970);
    expect(frames).toHaveLength(30);
    expect(frames.at(-1)).toMatchObject({
      detected: true,
      confidence: 0.95,
      handedness: 'left',
    });
    expect(frames.at(-1)?.joints?.thumb.dip).toBe(0);
    const frame = frames.at(-1)!;
    expect(frame.rawFlexSum!.index).toBeCloseTo(frame.closure!.index * 270);
    expect(frame.pinch).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(world.vision.videoElement()).toBeNull();
  });
  it('camera measures five independent world positions, including ring and pinky', async () => {
    const world = new SimWorld({ autoStart: false });
    await world.vision.start({ affectedHand: 'right' });
    world.vision.setCalibration(calibration);
    world.patient.position = [1, 1, 1, 1, 1];
    // A settled passive hand gives every finger a distinct closure.
    world.servoPosition = [0.1, 0.3, 0.5, 0.7, 0.9];
    world.firmware.position = [...world.servoPosition];
    world.firmware.goal = [...world.servoPosition];
    world.firmware.attached.fill(true);
    world.advance(100);
    const frame = world.vision.latest()!;
    for (const [i, finger] of [
      'thumb',
      'index',
      'middle',
      'ring',
      'pinky',
    ].entries()) {
      expect(frame.closure![finger as keyof typeof zeros]).toBeCloseTo(
        0.9 - i * 0.2,
        1,
      );
    }
    expect(frame.joints!.ring.pip).toBeLessThan(frame.joints!.middle.pip);
    expect(frame.rawFlexSum!.pinky).toBeLessThan(frame.rawFlexSum!.ring);
  });
  it('uncalibrated frames retain raw flex and joints; closure is null', async () => {
    const world = new SimWorld({ autoStart: false });
    await world.vision.start({ affectedHand: 'right' });
    world.advance(100);
    expect(world.vision.latest()?.closure).toBeNull();
    expect(world.vision.latest()?.rawFlexSum).not.toBeNull();
  });
  it('handOutOfFrame emits undetected frames after latency, recovers and stops without queued frames', async () => {
    const world = new SimWorld({ autoStart: false });
    await world.vision.start({ affectedHand: 'right' });
    world.vision.setCalibration(calibration);
    world.advance(200);
    world.controls.handOutOfFrame(500);
    world.advance(100);
    expect(world.vision.latest()).toMatchObject({
      detected: false,
      confidence: 0,
      closure: null,
      joints: null,
      pinch: null,
    });
    world.advance(500);
    expect(world.vision.latest()?.detected).toBe(true);
    let count = 0;
    const unsub = world.vision.onFrame(() => count++);
    world.vision.stop();
    world.advance(200);
    expect(count).toBe(0);
    expect(world.vision.latest()).toBeNull();
    unsub();
  });
  it('rigid finger produces a visible commanded-position gap for engine resistance attribution', async () => {
    const world = new SimWorld({ autoStart: false });
    await world.glove.connect();
    for (const i of [0, 1, 2, 3, 4] as const) world.glove.calib(i, 20, 150);
    await world.vision.start({ affectedHand: 'right' });
    world.vision.setCalibration(calibration);
    world.controls.setRigid('index', true);
    let peakGap = 0;
    world.glove.onTelemetry((tel) => {
      const closure = world.vision.latest()?.closure;
      if (closure && tel.st === 'run')
        peakGap = Math.max(peakGap, tel.a[1] - pullFromClosure(closure.index));
    });
    world.glove.target([1, 1, 1, 1, 1], 0.3);
    world.advance(2000);
    expect(peakGap).toBeGreaterThan(0.05);
  });
  it('STOP controls latch, releaseStop emits stop_released and setPreset changes the model', async () => {
    const world = new SimWorld({ autoStart: false });
    await world.glove.connect();
    const events: string[] = [];
    world.glove.onEvent((e) => events.push(e.e));
    world.controls.pressStop();
    world.glove.release();
    expect(world.firmware.state).toBe('fault');
    world.controls.releaseStop();
    expect(events).toEqual(['stop_button', 'stop_released']);
    world.glove.release();
    expect(world.firmware.state).toBe('idle');
    world.controls.setPreset('severe');
    expect(world.patient.preset).toBe('severe');
  });
  it('real-time timeScale uses elapsed wall time and can stop/restart without clock drift', async () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'performance'],
    });
    const world = new SimWorld({ timeScale: 2 });
    await world.glove.connect();
    await vi.advanceTimersByTimeAsync(1000);
    expect(world.now).toBe(2000);
    world.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(world.now).toBe(2000);
    await world.glove.connect();
    await vi.advanceTimersByTimeAsync(100);
    expect(world.now).toBe(2200);
    world.stop();
  });
  it('lazy connection and restart keep real-time timestamps aligned to performance.now()', async () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'performance'],
    });
    const world = new SimWorld();
    await vi.advanceTimersByTimeAsync(5000);
    await world.glove.connect();
    await vi.advanceTimersByTimeAsync(20);
    expect(world.glove.latest()?.t).toBe(performance.now());
    world.stop();
    await vi.advanceTimersByTimeAsync(2000);
    await world.glove.connect();
    await vi.advanceTimersByTimeAsync(20);
    expect(world.glove.latest()?.t).toBe(performance.now());
    world.stop();
  });
  it('rejects invalid timeScale and advance durations', () => {
    expect(() => new SimWorld({ timeScale: 0 })).toThrow();
    const world = new SimWorld({ autoStart: false });
    expect(() => world.advance(-1)).toThrow();
    expect(() => world.advance(Infinity)).toThrow();
  });
});
