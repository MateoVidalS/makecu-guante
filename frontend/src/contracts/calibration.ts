import type { GloveFinger } from './glove';
import type { FingerId, Handedness } from './vision';

// ---------- calibration (src/contracts/calibration.ts) ----------
export interface ServoCalibration {
  finger: GloveFinger;
  min_deg: number; // pull 0 = SLACK: thread just taut with the relaxed hand in a full fist (never blocks closing)
  max_deg: number; // pull 1 = OPEN: finger straight, neutral, never bent back. Never swap min/max to change direction.
}
/**
 * Which way the glove assists (docs/plan/15-open-assist.md). 'open' = dorsal routing, the glove opens the hand.
 * Absent = legacy 'close' (palm-side routing). Only CURRENT_ASSIST_DIRECTION is valid for practice.
 */
export type AssistDirection = 'close' | 'open';
export const CURRENT_ASSIST_DIRECTION: AssistDirection = 'open';
/**
 * Where the camera sees the hand from (docs/plan/14-camera-front-upright.md).
 * front_upright: laptop webcam, hand raised palm to the screen (current setup).
 * front_diagonal: legacy palm-down setup with a side webcam.
 */
export type CameraView = 'front_upright' | 'front_diagonal';
export const CURRENT_CAMERA_VIEW: CameraView = 'front_upright';
export interface CameraCalibration {
  affected_hand: Handedness;
  /** Absent in calibrations saved before Nov 7 = 'front_diagonal' (invalid for the current view). */
  camera_view?: CameraView;
  open_flex: Record<FingerId, number>; // raw flex sum, relaxed hand opened by the glove (sim glove: the patient's own open hand)
  closed_flex: Record<FingerId, number>; // raw flex sum, the patient's own fist (the glove cannot close)
  pinch_closed: number; // pinch ratio when thumb and index touch
  pinch_open: number;
}
export interface FrictionCurve {
  v: number;
  points: { pos: number; ma: number }[];
} // empty glove, per finger and speed
export interface Calibration {
  id: number;
  created_at: string;
  servo: ServoCalibration[]; // 3
  camera: CameraCalibration;
  friction: Partial<Record<GloveFinger, FrictionCurve[]>>; // slow and fast; may be empty if skipped
  current_limit_ma: number; // default 900
  /** Absent = legacy 'close'. Not CURRENT_ASSIST_DIRECTION = calibration needed. */
  assist_direction?: AssistDirection;
}
