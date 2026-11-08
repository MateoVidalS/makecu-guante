import type { GloveFinger } from './glove';
import type { FingerId, Handedness } from './vision';

// ---------- calibration (src/contracts/calibration.ts) ----------
export interface ServoCalibration {
  finger: GloveFinger;
  min_deg: number;
  max_deg: number;
}
/**
 * Where the camera sees the hand from (docs/plan/14-camera-front-upright.md).
 * front_upright: laptop webcam, hand raised palm to the screen (current setup).
 * front_diagonal: legacy palm-down setup with a side webcam.
 */
export type CameraView = 'front_upright' | 'front_diagonal';
export const CURRENT_CAMERA_VIEW: CameraView = 'front_upright';
export const CURRENT_FLEX_MODEL = 2;
export interface CameraCalibration {
  affected_hand: Handedness;
  /** Absent in calibrations saved before Nov 7 = 'front_diagonal' (invalid for the current view). */
  camera_view?: CameraView;
  /** absent = 1, the unsigned math before P1 */
  flex_model?: number;
  open_flex: Record<FingerId, number>; // raw flex sum, open hand
  closed_flex: Record<FingerId, number>; // raw flex sum, glove-closed relaxed hand (the glove closes all five fingers)
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
}
