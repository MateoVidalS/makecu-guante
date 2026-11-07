import {
  VISION_LOW_CONFIDENCE,
  type FingerId,
  type VisionFrame,
} from '../contracts/vision';
import { FINGERS, fingerMap } from './flex';

export const CAMERA_PLACEMENT_GUIDANCE =
  'Rest your forearm on a towel, palm down, with the wrist module at the table edge and fingers free to close. Place the camera 30–40 cm away, in front on the thumb side, diagonally above your hand.';

/** Setup heuristics, pending the team's real-glove day-1 check; not clinical thresholds. */
export const ROBUSTNESS_THRESHOLDS = {
  windowMs: 5000,
  maxFrameAgeMs: 100,
  minDetectionRate: 0.9,
  minMeanConfidence: 0.75,
  minFingerVisibility: 0.85,
} as const;

export interface VisionRobustnessStats {
  windowMs: number;
  observedMs: number;
  samples: number;
  detectionRate: number;
  meanConfidence: number;
  /** Fraction of time with a usable, in-frame skeleton for each finger.
   * MediaPipe may infer occluded joints: this is not an occlusion probability.
   */
  perFingerVisibility: Record<FingerId, number>;
  status: 'collecting' | 'poor' | 'ready';
  guidance: string[];
}

type Sample = {
  t: number;
  detected: boolean;
  confidence: number;
  visible: Record<FingerId, boolean>;
};
const bases = { thumb: 1, index: 5, middle: 9, ring: 13, pinky: 17 };
function sample(frame: VisionFrame): Sample {
  const detected =
    frame.detected &&
    Number.isFinite(frame.confidence) &&
    frame.confidence >= VISION_LOW_CONFIDENCE;
  return {
    t: frame.t,
    detected,
    confidence: detected ? Math.min(1, frame.confidence) : 0,
    visible: fingerMap((finger) => {
      const points = frame.landmarks;
      const joints = frame.joints?.[finger];
      if (
        !detected ||
        points?.length !== 21 ||
        !joints ||
        ![joints.mcp, joints.pip, joints.dip].every(Number.isFinite)
      )
        return false;
      return points
        .slice(bases[finger], bases[finger] + 4)
        .every(
          (p) =>
            p.length === 3 &&
            p.every(Number.isFinite) &&
            p[0] >= 0 &&
            p[0] <= 1 &&
            p[1] >= 0 &&
            p[1] <= 1,
        );
    }),
  };
}

/** Time-weighted rolling stats: watchdog frame frequency cannot bias the rate.
 * A frame expires after 100 ms, so silence and camera stalls count as missing.
 */
export class VisionRobustnessTracker {
  private samples: Sample[] = [];
  private started: number | null = null;

  reset(t?: number) {
    this.samples = [];
    this.started = t !== undefined && Number.isFinite(t) ? t : null;
  }
  add(frame: VisionFrame) {
    if (
      !Number.isFinite(frame.t) ||
      (this.started !== null && frame.t < this.started) ||
      (this.samples.length && frame.t <= this.samples.at(-1)!.t)
    )
      return;
    this.started ??= frame.t;
    this.samples.push(sample(frame));
    this.prune(frame.t - ROBUSTNESS_THRESHOLDS.windowMs);
  }
  private prune(start: number) {
    // Keep the observation straddling the window boundary.
    while (this.samples.length > 1 && this.samples[1].t <= start)
      this.samples.shift();
  }
  stats(now: number): VisionRobustnessStats {
    const {
      windowMs,
      maxFrameAgeMs,
      minDetectionRate,
      minMeanConfidence,
      minFingerVisibility,
    } = ROBUSTNESS_THRESHOLDS;
    const end = Number.isFinite(now) ? now : (this.samples.at(-1)?.t ?? 0);
    const start = Math.max(this.started ?? end, end - windowMs);
    const observedMs = Math.max(0, end - start);
    this.prune(start);
    let detectedMs = 0,
      confidenceMs = 0;
    const visibilityMs = fingerMap(() => 0);
    this.samples.forEach((s, i) => {
      const next = this.samples[i + 1]?.t ?? end;
      const duration = Math.max(
        0,
        Math.min(end, next, s.t + maxFrameAgeMs) - Math.max(start, s.t),
      );
      if (s.detected) detectedMs += duration;
      confidenceMs += duration * s.confidence;
      for (const finger of FINGERS)
        if (s.visible[finger]) visibilityMs[finger] += duration;
    });
    const fraction = (ms: number) => (observedMs > 0 ? ms / observedMs : 0);
    const detectionRate = fraction(detectedMs);
    const meanConfidence = fraction(confidenceMs);
    const perFingerVisibility = fingerMap((f) => fraction(visibilityMs[f]));
    const hidden = FINGERS.filter(
      (f) => perFingerVisibility[f] < minFingerVisibility,
    );
    const collecting = observedMs < windowMs;
    const good =
      detectionRate >= minDetectionRate &&
      meanConfidence >= minMeanConfidence &&
      !hidden.length;
    const guidance: string[] = [];
    if (collecting)
      guidance.push(
        'Keep your gloved hand visible for 5 seconds. Try opening and closing all five fingers.',
      );
    if (!collecting && !good) {
      guidance.push(CAMERA_PLACEMENT_GUIDANCE);
      if (
        detectionRate < minDetectionRate ||
        meanConfidence < minMeanConfidence
      )
        guidance.push(
          'Improve the lighting and use a light, thin glove. If detection stays low, ask the team about exposed fingertips or a bare-hand demo.',
        );
      if (hidden.length)
        guidance.push(
          `Keep these fingers in view: ${hidden.join(', ')}. Adjust the thumb-side camera angle to reduce overlap.`,
        );
    }
    if (!collecting && good)
      guidance.push(
        'Tracking looks steady. Check that the skeleton follows every finger while opening and closing.',
      );
    return {
      windowMs,
      observedMs,
      samples: this.samples.filter((s) => s.t >= start && s.t <= end).length,
      detectionRate,
      meanConfidence,
      perFingerVisibility,
      status: collecting ? 'collecting' : good ? 'ready' : 'poor',
      guidance,
    };
  }
}
