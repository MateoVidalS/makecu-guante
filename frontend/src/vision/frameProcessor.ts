import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import {
  CURRENT_CAMERA_VIEW,
  type CameraView,
  type CameraCalibration,
} from '../contracts/calibration';
import type { Handedness, VisionFrame } from '../contracts/vision';
import { ConfidenceTracker, selectHand } from './confidence';
import {
  fingerMap,
  jointAngles,
  normalizeClosure,
  pinchRatio,
  validLandmarks,
  type Landmark,
} from './flex';
import { JointFilter } from './jointFilter';
import { OneEuroFilter } from './oneEuro';

export type HandResult = Pick<
  HandLandmarkerResult,
  'landmarks' | 'worldLandmarks' | 'handedness'
>;
export function missingFrame(t: number): VisionFrame {
  return {
    t,
    detected: false,
    confidence: 0,
    handedness: null,
    closure: null,
    rawFlexSum: null,
    joints: null,
    pinch: null,
    landmarks: null,
  };
}
/** Shared by the camera and fixture tests, independent of the DOM and MediaPipe runtime. */
export class FrameProcessor {
  calibration: CameraCalibration | null = null;
  handednessMismatch: boolean | null = null;
  readonly confidence = new ConfidenceTracker();
  private jointFilter = new JointFilter();
  private pinchFilter = new OneEuroFilter();
  private hand: Handedness | null = null;
  private view: CameraView | null = null;
  private lastSeen = -Infinity;
  reset() {
    this.jointFilter.reset();
    this.pinchFilter.reset();
    this.confidence.reset();
    this.lastSeen = -Infinity;
    this.hand = null;
    this.view = null;
    this.handednessMismatch = null;
  }
  process(
    result: HandResult,
    t: number,
    affected: Handedness,
    mirror = false,
    view: CameraView = CURRENT_CAMERA_VIEW,
  ): VisionFrame {
    const selected = selectHand(result.handedness, affected, mirror, view);
    const tuples = (
      points: { x: number; y: number; z: number }[] | undefined,
    ) => points?.map((p): Landmark => [p.x, p.y, p.z]) ?? [];
    const world = tuples(
      selected ? result.worldLandmarks[selected.index] : undefined,
    );
    const image = tuples(
      selected ? result.landmarks[selected.index] : undefined,
    );
    if (!selected || !validLandmarks(world) || !validLandmarks(image))
      return this.missing(t);
    try {
      const raw = jointAngles(world, view),
        pinch = pinchRatio(image);
      if (
        this.hand !== affected ||
        this.view !== view ||
        t - this.lastSeen >= 200
      )
        this.reset();
      this.handednessMismatch = selected.mismatch;
      this.hand = affected;
      this.view = view;
      this.lastSeen = t;
      // Every joint is filtered, so the rendered hand and the normalized closure
      // share one smoothed timeline (closure derives from the same angles).
      const joints = this.jointFilter.filter(raw, t);
      const rawFlexSum = fingerMap(
        (finger) =>
          joints[finger].mcp + joints[finger].pip + joints[finger].dip,
      );
      const c = this.calibration;
      return {
        t,
        detected: true,
        confidence: this.confidence.update(selected.score, t),
        handedness: selected.handedness,
        closure:
          c &&
          c.affected_hand === affected &&
          (c.camera_view ?? 'front_diagonal') === view
            ? fingerMap((finger) =>
                normalizeClosure(
                  rawFlexSum[finger],
                  c.open_flex[finger],
                  c.closed_flex[finger],
                ),
              )
            : null,
        rawFlexSum,
        joints,
        pinch: this.pinchFilter.filter(pinch, t),
        landmarks: image,
      };
    } catch {
      return this.missing(t);
    }
  }
  missing(t: number): VisionFrame {
    this.handednessMismatch = null;
    this.confidence.update(null, t);
    if (t - this.lastSeen >= 200) this.reset();
    return missingFrame(t);
  }
}
