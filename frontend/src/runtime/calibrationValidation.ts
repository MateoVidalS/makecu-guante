import type { CameraCalibration } from '../contracts/calibration';
import { GLOVE_FINGERS } from '../contracts/glove';
import type { VisionFrame } from '../contracts/vision';
import { jointsFromClosure } from '../glove/sim/simVision';

/** Validate raw camera units, before normalization can hide an undersized range. */
export function validateCameraRange(
  camera: CameraCalibration,
  simulatedCamera: boolean,
  frame: VisionFrame | null,
): void {
  const closed = jointsFromClosure({
    thumb: 1,
    index: 1,
    middle: 1,
    ring: 1,
    pinky: 1,
  });
  for (const finger of GLOVE_FINGERS) {
    const open = camera.open_flex[finger];
    const span = camera.closed_flex[finger] - open;
    if (!Number.isFinite(open) || !Number.isFinite(span) || span <= 0)
      throw new Error(
        `Capture a valid open and closed camera range for your ${finger}.`,
      );
    const joints = closed[finger];
    const expected = simulatedCamera
      ? joints.mcp + joints.pip + joints.dip
      : frame?.detected && frame.confidence >= 0.6
        ? frame.rawFlexSum?.[finger]
        : undefined;
    // Allow the camera's small endpoint noise. A 110% reading is a calibration
    // mismatch, not extra patient range; never silently accept it as a new maximum.
    if (expected !== undefined && (expected - open) / span > 1.05)
      throw new Error(
        `Camera range would report over 100% for your ${finger}. Recapture open and relaxed glove-closed positions together.`,
      );
  }
}
