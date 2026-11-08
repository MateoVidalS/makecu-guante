import {
  CURRENT_ASSIST_DIRECTION,
  CURRENT_CAMERA_VIEW,
  CURRENT_FLEX_MODEL,
  type CameraCalibration,
  type Calibration,
} from '../contracts/calibration';
import { GLOVE_FINGERS } from '../contracts/glove';
import type { TherapyRuntime as Runtime } from './therapy';
import type { Handedness } from '../contracts/vision';
import type { SimWorld } from '../glove/sim/simWorld';

/**
 * Test mode: no glove motors. The glove switches to the simulator (its motors only exist on
 * screen), the camera stays as it is (your real hand), and a calibration is saved so practice,
 * the AI coach and history all work. Nothing is sent to hardware.
 */
export const TEST_SERVO_RANGE = { min_deg: 20, max_deg: 150 };

/** Typical raw flex sums for an open hand and a fist. Finger percentages are approximate. */
export function standardCamera(hand: Handedness): CameraCalibration {
  return {
    affected_hand: hand,
    camera_view: CURRENT_CAMERA_VIEW,
    flex_model: CURRENT_FLEX_MODEL,
    open_flex: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
    closed_flex: { thumb: 100, index: 270, middle: 270, ring: 270, pinky: 270 },
    pinch_closed: 0.1,
    pinch_open: 1,
  };
}

/** A camera range captured for this hand, in the current view and flex model, is reused. */
export function reusableCamera(
  camera: CameraCalibration | null | undefined,
  hand: Handedness,
): CameraCalibration | null {
  if (
    !camera ||
    camera.affected_hand !== hand ||
    camera.camera_view !== CURRENT_CAMERA_VIEW ||
    camera.flex_model !== CURRENT_FLEX_MODEL
  )
    return null;
  const valid = GLOVE_FINGERS.every(
    (f) =>
      Number.isFinite(camera.open_flex[f]) &&
      camera.closed_flex[f] - camera.open_flex[f] > 0,
  );
  return valid ? camera : null;
}

export async function enterTestMode(
  runtime: Runtime,
  world: SimWorld | undefined,
  options: { hand: Handedness; camera?: CameraCalibration | null },
): Promise<{ calibration: Calibration; cameraReused: boolean }> {
  if (runtime.sources.glove !== 'sim') await runtime.sources.setGlove('sim');
  // A simulated patient without muscle tone: its current never looks like resistance, so the
  // motor panel shows the commands only (what the motors would do with your real hand).
  world?.controls.setPreset('demo');
  const reused =
    reusableCamera(options.camera, options.hand) ??
    reusableCamera(runtime.calibration.current?.camera, options.hand);
  const calibration = await runtime.calibration.save({
    assist_direction: CURRENT_ASSIST_DIRECTION,
    servo: GLOVE_FINGERS.map((finger) => ({ finger, ...TEST_SERVO_RANGE })),
    camera: reused ?? standardCamera(options.hand),
    friction: {},
    current_limit_ma: 1500,
  });
  await runtime.calibration.sendToGlove();
  return { calibration, cameraReused: !!reused };
}
