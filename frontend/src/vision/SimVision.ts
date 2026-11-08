import {
  CURRENT_CAMERA_VIEW,
  type CameraView,
  type CameraCalibration,
} from '../contracts/calibration';
import type { VisionFrame, VisionSource } from '../contracts/vision';

/** View-aware vision boundary around the shared simulator, without another clock.
 * Simulated joints/closure are camera-independent; no image landmarks are rotated.
 */
export class SimVision implements VisionSource {
  readonly kind = 'sim' as const;
  private view: CameraView = CURRENT_CAMERA_VIEW;
  constructor(readonly delegate: VisionSource) {
    if (delegate.kind !== 'sim') throw new Error('Expected simulated vision');
  }
  cameraView(): CameraView {
    return this.view;
  }
  async start(options: Parameters<VisionSource['start']>[0]) {
    // Discard observations queued under the previous hand/view before restarting.
    this.delegate.stop();
    this.view = options.view ?? CURRENT_CAMERA_VIEW;
    await this.delegate.start({ ...options, view: this.view });
  }
  stop() {
    this.delegate.stop();
  }
  setCalibration(calibration: CameraCalibration | null) {
    this.delegate.setCalibration(calibration);
  }
  onFrame(callback: (frame: VisionFrame) => void) {
    return this.delegate.onFrame(callback);
  }
  latest() {
    return this.delegate.latest();
  }
  videoElement() {
    return this.delegate.videoElement();
  }
}
