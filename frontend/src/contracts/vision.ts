import type { Unsubscribe } from './runtime';
import type { CameraCalibration } from './calibration';

// ---------- vision (src/contracts/vision.ts) ----------
export type FingerId = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';
export type Handedness = 'left' | 'right';
export interface JointAngles {
  mcp: number;
  pip: number;
  dip: number;
} // degrees of flexion; thumb: mcp, ip in pip, dip=0
export interface VisionFrame {
  t: number; // performance.now()
  detected: boolean;
  confidence: number; // 0..1; 0 when not detected
  handedness: Handedness | null;
  closure: Record<FingerId, number> | null; // normalized + smoothed; null if uncalibrated or not detected
  rawFlexSum: Record<FingerId, number> | null; // degrees, smoothed, before normalization
  joints: Record<FingerId, JointAngles> | null;
  pinch: number | null; // thumb-tip↔index-tip distance / hand size (wrist→middle MCP)
  landmarks: [number, number, number][] | null; // 21 image-space points (for the overlay)
}
export interface VisionSource {
  // implemented by CameraVision (WP3) and SimVision (WP2)
  readonly kind: 'camera' | 'sim';
  start(opts: { deviceId?: string; affectedHand: Handedness }): Promise<void>;
  stop(): void;
  setCalibration(c: CameraCalibration | null): void;
  onFrame(cb: (f: VisionFrame) => void): Unsubscribe;
  latest(): VisionFrame | null;
  videoElement(): HTMLVideoElement | null; // camera preview (null for sim)
}
export const VISION_LOW_CONFIDENCE = 0.6; // below this, frames count as "not seen"
