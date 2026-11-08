// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { SimWorld } from '../glove/sim';
import { createGloveController } from '../glove/GloveProvider';
import { createVisionController } from '../vision/VisionProvider';
import { RehabRuntime } from './runtime';
import * as api from '../api/client';
import { calibration as fixture } from '../contracts/fixtures.check';
import { DEFAULT_EXERCISE_SETTINGS } from '../contracts/poses';
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

it("saves today's plan decision with the session it started (docs/plan/17)", async () => {
  const calibration: Calibration = structuredClone(fixture);
  calibration.assist_direction = 'open';
  calibration.current_limit_ma = 1500;
  calibration.camera.camera_view = CURRENT_CAMERA_VIEW;
  calibration.camera.flex_model = CURRENT_FLEX_MODEL;
  vi.spyOn(api, 'getLatestCalibration').mockResolvedValue(calibration);
  const world = new SimWorld({ autoStart: false, seed: 3, preset: 'moderate' });
  const glove = createGloveController({ world, kind: 'sim' });
  const camera = fakeCamera();
  const vision = createVisionController({
    simSource: world.vision,
    cameraSource: camera.source,
    initialKind: 'camera',
  });
  const created = vi.fn().mockResolvedValue({ id: 41 });
  const decisions = vi.fn().mockResolvedValue(undefined);
  const noop = vi.fn().mockResolvedValue({ id: 1 });
  const runtime = new RehabRuntime({
    glove,
    vision,
    api: {
      createSession: created,
      addAttempt: noop,
      endSession: noop,
      addCoachDecisions: decisions,
      addFeelings: noop,
      createEvaluation: noop,
    } as never,
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
  camera.emit(0.9);
  await runtime.exercise.start([{ pose: 'open', reps: 1 }], {
    // As applyPlan() builds it: the trying time is in the contract settings too.
    ...DEFAULT_EXERCISE_SETTINGS,
    attempt_s: 7,
    progression: {
      target_scale: { pinky: 0.6 },
      attempt_s: 7,
      challenge: 'standard',
      sessions: [3, 2, 1],
      summary: "Today's plan from 3 recent sessions (standard).",
    },
  } as typeof DEFAULT_EXERCISE_SETTINGS);
  await vi.waitFor(() => expect(decisions).toHaveBeenCalled());
  const [id, saved] = decisions.mock.calls[0];
  expect(id).toBe(41);
  expect(saved).toEqual([
    expect.objectContaining({
      tool: 'progression_plan',
      session_id: 41,
      source: 'local_rule',
      applied: { target_scale: { pinky: 0.6 }, attempt_s: 7 },
    }),
  ]);
  // Only contract settings are stored, with the trying time actually used.
  const body = created.mock.calls[0][0];
  expect(body.settings.attempt_s).toBe(7);
  expect(body.settings).not.toHaveProperty('progression');
});
