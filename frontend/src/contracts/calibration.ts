import type { GloveFinger } from './glove';
import type { FingerId, Handedness } from './vision';

// ---------- calibration (src/contracts/calibration.ts) ----------
export interface ServoCalibration {
  finger: GloveFinger;
  min_deg: number;
  max_deg: number;
}
export interface CameraCalibration {
  affected_hand: Handedness;
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
