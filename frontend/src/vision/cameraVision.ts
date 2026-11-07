import type {
  VisionSource,
  VisionFrame,
  Handedness,
} from '../contracts/vision';
import type { CameraCalibration } from '../contracts/calibration';
export class CameraVision implements VisionSource {
  readonly kind = 'camera' as const;
  async start(_options: {
    deviceId?: string;
    affectedHand: Handedness;
  }): Promise<void> {
    throw new Error('WP3');
  }
  stop() {}
  setCalibration(_c: CameraCalibration | null) {}
  onFrame(_cb: (frame: VisionFrame) => void) {
    return () => {};
  }
  latest(): VisionFrame | null {
    return null;
  }
  videoElement(): HTMLVideoElement | null {
    return null;
  }
}
