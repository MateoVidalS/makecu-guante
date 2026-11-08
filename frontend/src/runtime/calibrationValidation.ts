import { isCurrentCameraCalibration } from '../vision/calibrationCompatibility';
import { useCallback, useSyncExternalStore } from 'react';
import {
  CURRENT_ASSIST_DIRECTION,
  type Calibration,
  type CameraCalibration,
} from '../contracts/calibration';
import { GLOVE_FINGERS } from '../contracts/glove';
import type { FingerId, VisionFrame } from '../contracts/vision';
import { jointsFromClosure } from '../glove/sim/simVision';
import { useVision, useVisionFrame } from '../vision';
import { useRuntime } from './RuntimeProvider';

export const ASSIST_DIRECTION_RECALIBRATE_MESSAGE =
  'The glove now helps the hand open. Calibrate it again.';

export const CAMERA_VIEW_RECAPTURE_MESSAGE =
  'Your camera range needs to be updated. Redo the camera step with your hand raised, palm to the screen.';

export interface CalibrationIssue {
  /** Absent when a whole calibration step needs redoing. */
  finger?: FingerId;
  step: 'glove' | 'camera';
  message: string;
}
export interface CalibrationStatus {
  state: 'missing' | 'invalid' | 'ok';
  issues: CalibrationIssue[];
}
const simulatedClosed = jointsFromClosure({
  thumb: 1,
  index: 1,
  middle: 1,
  ring: 1,
  pinky: 1,
});
function cameraRangeError(
  camera: CameraCalibration,
  finger: FingerId,
  simulatedCamera: boolean,
  frame: VisionFrame | null,
): string | null {
  const open = camera.open_flex[finger];
  const span = camera.closed_flex[finger] - open;
  if (!Number.isFinite(open) || !Number.isFinite(span) || span <= 0)
    return `Capture a valid open and closed camera range for your ${finger}.`;
  const joints = simulatedClosed[finger];
  const expected = simulatedCamera
    ? joints.mcp + joints.pip + joints.dip
    : frame?.detected && frame.confidence >= 0.6
      ? frame.rawFlexSum?.[finger]
      : undefined;
  // Match the runtime gate before normalization can hide an undersized range.
  if (expected !== undefined && (expected - open) / span > 1.05)
    return `Camera range would report over 100% for your ${finger}. Recapture open and your own fist positions together.`;
  return null;
}

/** Validate raw camera units, before normalization can hide an undersized range. */
export function validateCameraRange(
  camera: CameraCalibration,
  simulatedCamera: boolean,
  frame: VisionFrame | null,
): void {
  for (const finger of GLOVE_FINGERS) {
    const error = cameraRangeError(camera, finger, simulatedCamera, frame);
    if (error) throw new Error(error);
  }
}

/** Shared by saved readiness and the wizard's unsaved Review values. */
export function selectCalibrationStatus(
  calibration: Pick<
    Calibration,
    'servo' | 'camera' | 'assist_direction'
  > | null,
  simulatedCamera: boolean,
  frame: VisionFrame | null,
): CalibrationStatus {
  if (!calibration) return { state: 'missing', issues: [] };
  const issues: CalibrationIssue[] = [];
  if (calibration.assist_direction !== CURRENT_ASSIST_DIRECTION)
    issues.push({
      step: 'glove',
      message: ASSIST_DIRECTION_RECALIBRATE_MESSAGE,
    });
  const add = (finger: FingerId, step: CalibrationIssue['step']) =>
    issues.push({
      finger,
      step,
      message: `Your ${finger} range needs a quick redo.`,
    });
  for (const finger of GLOVE_FINGERS) {
    const servo = calibration.servo.find((range) => range.finger === finger);
    if (
      !servo ||
      !Number.isFinite(servo.min_deg) ||
      !Number.isFinite(servo.max_deg) ||
      servo.min_deg < 5 ||
      servo.min_deg > 175 ||
      servo.max_deg < 5 ||
      servo.max_deg > 175 ||
      Math.abs(servo.max_deg - servo.min_deg) < 20
    )
      add(finger, 'glove');
  }
  if (!isCurrentCameraCalibration(calibration.camera)) {
    issues.push({
      step: 'camera',
      message: CAMERA_VIEW_RECAPTURE_MESSAGE,
    });
  } else {
    for (const finger of GLOVE_FINGERS) {
      if (cameraRangeError(calibration.camera, finger, simulatedCamera, frame))
        add(finger, 'camera');
    }
  }
  return { state: issues.length ? 'invalid' : 'ok', issues };
}

/** The frozen calibration API has no subscription. Observe replacement references,
 * including reloads while the camera is stopped, without changing that contract. */
export function useSavedCalibration() {
  const runtime = useRuntime();
  return useSyncExternalStore(
    useCallback((notify: () => void) => {
      const timer = setInterval(notify, 250);
      return () => clearInterval(timer);
    }, []),
    () => runtime.calibration.current,
  );
}
export function useCalibrationStatus(): CalibrationStatus {
  const calibration = useSavedCalibration();
  const vision = useVision();
  const frame = useVisionFrame((value) => value);
  return selectCalibrationStatus(
    calibration,
    vision.source.kind === 'sim',
    frame,
  );
}
export const calibrationIssueHref = (issue: CalibrationIssue) =>
  `/calibrate?step=${issue.step}${issue.finger ? `&finger=${issue.finger}` : ''}`;
export function calibrationReadiness(status: CalibrationStatus) {
  return {
    label: 'Calibration',
    value:
      status.state === 'ok'
        ? 'Ready'
        : status.state === 'invalid'
          ? status.issues.some(
              (issue) =>
                issue.message === CAMERA_VIEW_RECAPTURE_MESSAGE ||
                issue.message === ASSIST_DIRECTION_RECALIBRATE_MESSAGE,
            )
            ? 'Needed'
            : 'Needs a quick redo'
          : 'Needed',
    tone: status.state === 'ok' ? ('reached' as const) : ('caution' as const),
    href: status.issues[0]
      ? calibrationIssueHref(status.issues[0])
      : '/calibrate',
    action:
      status.state === 'ok'
        ? 'Review'
        : status.state === 'invalid'
          ? 'Fix'
          : 'Calibrate',
  };
}
