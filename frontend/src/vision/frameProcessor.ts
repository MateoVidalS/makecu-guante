import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { CameraCalibration } from '../contracts/calibration';
import type { Handedness, VisionFrame } from '../contracts/vision';
import { ConfidenceTracker, selectHand } from './confidence';
import {
  FINGERS,
  fingerMap,
  jointAngles,
  normalizeClosure,
  pinchRatio,
  validLandmarks,
  type Landmark,
} from './flex';
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
  readonly confidence = new ConfidenceTracker();
  private filters = fingerMap(() => new OneEuroFilter());
  private pinchFilter = new OneEuroFilter();
  private hand: Handedness | null = null;
  private lastSeen = -Infinity;
  reset() {
    FINGERS.forEach((finger) => this.filters[finger].reset());
    this.pinchFilter.reset();
    this.confidence.reset();
    this.lastSeen = -Infinity;
    this.hand = null;
  }
  process(
    result: HandResult,
    t: number,
    affected: Handedness,
    mirror = false,
  ): VisionFrame {
    const selected = selectHand(result.handedness, affected, mirror);
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
      const joints = jointAngles(world),
        pinch = pinchRatio(image);
      if (this.hand !== selected.handedness || t - this.lastSeen >= 200)
        this.reset();
      this.hand = selected.handedness;
      this.lastSeen = t;
      const rawFlexSum = fingerMap((finger) => {
        const { mcp, pip, dip } = joints[finger];
        const raw = mcp + pip + dip;
        const filtered = this.filters[finger].filter(raw, t);
        // Keep rendered joints and normalized closure on the same filtered timeline.
        const scale = raw > 1e-6 ? filtered / raw : 0;
        joints[finger] =
          raw > 1e-6
            ? { mcp: mcp * scale, pip: pip * scale, dip: dip * scale }
            : { mcp: filtered, pip: 0, dip: 0 };
        return filtered;
      });
      const c = this.calibration;
      return {
        t,
        detected: true,
        confidence: this.confidence.update(selected.score, t),
        handedness: selected.handedness,
        closure:
          c && c.affected_hand === affected
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
    this.confidence.update(null, t);
    if (t - this.lastSeen >= 200) this.reset();
    return missingFrame(t);
  }
}
