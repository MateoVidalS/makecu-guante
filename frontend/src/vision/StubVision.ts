import type {
  VisionFrame,
  VisionSource,
  Handedness,
} from '../contracts/vision';
import type { CameraCalibration } from '../contracts/calibration';
export class StubVision implements VisionSource {
  readonly kind = 'sim' as const;
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame: VisionFrame | null = null;
  private listeners = new Set<(f: VisionFrame) => void>();
  async start({
    affectedHand,
  }: {
    deviceId?: string;
    affectedHand: Handedness;
  }) {
    this.stop();
    this.timer = setInterval(() => {
      const t = performance.now(),
        c = 0.4 + 0.2 * Math.sin(t / 1500);
      this.frame = {
        t,
        detected: true,
        confidence: 0.95,
        handedness: affectedHand,
        closure: { thumb: c * 0.7, index: c, middle: c, ring: c, pinky: c },
        rawFlexSum: null,
        joints: null,
        pinch: 0.4,
        landmarks: null,
      };
      this.listeners.forEach((cb) => cb(this.frame!));
    }, 33);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  setCalibration(_c: CameraCalibration | null) {
    /* WP3 */
  }
  onFrame(cb: (f: VisionFrame) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  latest() {
    return this.frame;
  }
  videoElement() {
    return null;
  }
}
