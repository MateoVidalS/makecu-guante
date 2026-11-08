import {
  VISION_LOW_CONFIDENCE,
  type FingerId,
  type VisionFrame,
} from '../contracts/vision';
import { FINGERS, fingerMap } from './flex';
import {
  lightingStatus,
  type LightingStats,
  type VisionDiagnostics,
} from './lighting';

export const CAMERA_PLACEMENT_GUIDANCE =
  'Raise your hand beside your face, palm facing the laptop screen, with your elbow supported on the table or an armrest. Keep your hand 40–60 cm from the front webcam.';

/** Setup heuristics, pending the team's day-1 bare-hand-with-points check; not clinical thresholds. */
export const ROBUSTNESS_THRESHOLDS = {
  windowMs: 5000,
  maxFrameAgeMs: 100,
  minDetectionRate: 0.9,
  minMeanConfidence: 0.75,
  minFingerVisibility: 0.85,
  maxHandednessMismatchRate: 0.2,
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
  /** null if the source cannot sample video exposure. Optional for existing consumers. */
  lighting?: LightingStats | null;
  /** Fraction of recognized upright-hand observations disagreeing with configuration. */
  handednessMismatchRate?: number | null;
}

type Sample = {
  t: number;
  detected: boolean;
  confidence: number;
  visible: Record<FingerId, boolean>;
  diagnostics?: VisionDiagnostics;
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
  add(frame: VisionFrame, diagnostics?: VisionDiagnostics) {
    if (
      !Number.isFinite(frame.t) ||
      (this.started !== null && frame.t < this.started) ||
      (this.samples.length && frame.t <= this.samples.at(-1)!.t)
    )
      return;
    this.started ??= frame.t;
    this.samples.push({ ...sample(frame), diagnostics });
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
      maxHandednessMismatchRate,
    } = ROBUSTNESS_THRESHOLDS;
    const end = Number.isFinite(now) ? now : (this.samples.at(-1)?.t ?? 0);
    const start = Math.max(this.started ?? end, end - windowMs);
    const observedMs = Math.max(0, end - start);
    this.prune(start);
    let detectedMs = 0,
      confidenceMs = 0;
    let lightingMs = 0,
      luminanceMs = 0,
      handMs = 0,
      handLuminanceMs = 0,
      backgroundMs = 0,
      backgroundLuminanceMs = 0,
      checkedMs = 0,
      mismatchedMs = 0;
    const visibilityMs = fingerMap(() => 0);
    this.samples.forEach((s, i) => {
      const next = this.samples[i + 1]?.t ?? end;
      const duration = Math.max(
        0,
        Math.min(end, next, s.t + maxFrameAgeMs) - Math.max(start, s.t),
      );
      const lighting = s.diagnostics?.lighting;
      if (lighting) {
        lightingMs += duration;
        luminanceMs += duration * lighting.meanLuminance;
        if (lighting.handLuminance !== null) {
          handMs += duration;
          handLuminanceMs += duration * lighting.handLuminance;
        }
        if (lighting.backgroundLuminance !== null) {
          backgroundMs += duration;
          backgroundLuminanceMs += duration * lighting.backgroundLuminance;
        }
      }
      const mismatch = s.diagnostics?.handednessMismatch;
      if (s.detected && mismatch !== null && mismatch !== undefined) {
        checkedMs += duration;
        if (mismatch) mismatchedMs += duration;
      }
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
    const meanLuminance = lightingMs ? luminanceMs / lightingMs : 0;
    const handLuminance = handMs ? handLuminanceMs / handMs : null;
    const backgroundLuminance = backgroundMs
      ? backgroundLuminanceMs / backgroundMs
      : null;
    const lighting: LightingStats | null = lightingMs
      ? {
          meanLuminance,
          handLuminance,
          backgroundLuminance,
          status: lightingStatus(
            meanLuminance,
            handLuminance,
            backgroundLuminance,
          ),
        }
      : null;
    const handednessMismatchRate = checkedMs ? mismatchedMs / checkedMs : null;
    const mismatch =
      handednessMismatchRate !== null &&
      handednessMismatchRate > maxHandednessMismatchRate;
    const collecting = observedMs < windowMs;
    const good =
      detectionRate >= minDetectionRate &&
      meanConfidence >= minMeanConfidence &&
      !hidden.length &&
      !mismatch &&
      (!lighting || lighting.status === 'good');
    const guidance: string[] = [];
    if (collecting)
      guidance.push(
        'Keep your whole hand in frame for 5 seconds. Try opening and closing all five fingers. Roll up your sleeve and remove rings, your watch and bracelets. Keep points clear of the joint creases on your palm side.',
      );
    if (lighting?.status === 'low_light')
      guidance.push(
        'Your hand is too dark. Add a light in front of you, facing your palm, and keep the room well lit.',
      );
    if (lighting?.status === 'backlit')
      guidance.push(
        'A bright background is leaving your hand in shadow. Move away from the window behind you or close the curtain, and light your palm from the laptop side.',
      );
    if (mismatch)
      guidance.push(
        'The camera hand label differs from your affected-hand setting. Check that the configured hand is correct and keep only that hand in view.',
      );
    if (!collecting && !good) {
      guidance.push(CAMERA_PLACEMENT_GUIDANCE);
      if (
        detectionRate < minDetectionRate ||
        meanConfidence < minMeanConfidence
      )
        guidance.push(
          'Use good light from in front of you, with no window behind you. If detection stays low, check the lighting and keep points small and on the back of your fingers.',
        );
      if (hidden.length)
        guidance.push(
          `Keep these fingers in view: ${hidden.join(', ')}. Face your palm toward the screen and adjust your hand inside the frame to reduce overlap.`,
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
      lighting,
      handednessMismatchRate,
    };
  }
}
