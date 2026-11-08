// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { SimWorld } from '../glove/sim';
import { createGloveController } from '../glove/GloveProvider';
import { createVisionController } from '../vision/VisionProvider';
import { RehabRuntime } from './runtime';
import * as api from '../api/client';
import { calibration as fixture } from '../contracts/fixtures.check';
import {
  OPEN_ASSIST_PLAN,
  DEFAULT_EXERCISE_SETTINGS,
} from '../contracts/poses';
import {
  CURRENT_CAMERA_VIEW,
  CURRENT_FLEX_MODEL,
  type Calibration,
} from '../contracts/calibration';
import type { VisionFrame, VisionSource } from '../contracts/vision';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((f) => f());
  vi.restoreAllMocks();
});

/** A real-camera double: frames are stamped with performance.now(), like CameraVision. */
function fakeCamera() {
  const listeners = new Set<(frame: VisionFrame) => void>();
  let latest: VisionFrame | null = null;
  const source: VisionSource = {
    kind: 'camera',
    start: async () => {},
    stop: () => {},
    setCalibration: () => {},
    onFrame: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    latest: () => latest,
    videoElement: () => null,
  };
  const emit = (closure: number) => {
    latest = {
      t: performance.now(),
      detected: true,
      confidence: 0.95,
      handedness: 'right',
      closure: {
        thumb: closure,
        index: closure,
        middle: closure,
        ring: closure,
        pinky: closure,
      },
      rawFlexSum: null,
      joints: null,
      pinch: null,
      landmarks: null,
    };
    listeners.forEach((cb) => cb(latest!));
  };
  return { source, emit };
}

it('a simulated glove with a real camera follows the camera clock, so practice leaves "Make a fist"', async () => {
  let wall = 10_000;
  vi.spyOn(performance, 'now').mockImplementation(() => wall);
  const calibration: Calibration = structuredClone(fixture);
  calibration.assist_direction = 'open';
  calibration.current_limit_ma = 1500;
  calibration.camera.camera_view = CURRENT_CAMERA_VIEW;
  calibration.camera.flex_model = CURRENT_FLEX_MODEL;
  vi.spyOn(api, 'getLatestCalibration').mockResolvedValue(calibration);
  const world = new SimWorld({ autoStart: false, seed: 7, preset: 'demo' });
  const glove = createGloveController({ world, kind: 'sim' });
  const camera = fakeCamera();
  const vision = createVisionController({
    simSource: world.vision,
    cameraSource: camera.source,
    initialKind: 'camera',
  });
  const noop = vi.fn().mockResolvedValue({ id: 1 });
  const runtime = new RehabRuntime({
    glove,
    vision,
    api: {
      createSession: noop,
      addAttempt: noop,
      endSession: noop,
      addCoachDecisions: noop,
      addFeelings: noop,
      createEvaluation: noop,
    } as never,
    // No `now` override: this is the production clock choice.
  });
  glove.mount();
  await vision.start();
  runtime.mount();
  await runtime.calibration.reload();
  cleanups.push(() => {
    runtime.dispose();
    vision.stop();
    glove.dispose();
  });
  camera.emit(0.95);
  await runtime.exercise.start(OPEN_ASSIST_PLAN, DEFAULT_EXERCISE_SETTINGS);
  expect(runtime.exercise.view().phase).toBe('PRESENT');
  // Hand tracking blocks the main thread: the simulator's timer only gets 80% of wall time.
  for (
    let step = 0;
    step < 200 && runtime.exercise.view().phase === 'PRESENT';
    step++
  ) {
    wall += 50;
    world.advance(40);
    camera.emit(0.95);
  }
  expect(runtime.exercise.view().phase).not.toBe('PRESENT');
});
