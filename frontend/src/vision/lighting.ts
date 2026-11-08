import type { Landmark } from './flex';

/** Provisional exposure heuristics for Setup, not a camera or clinical measurement. */
export const LIGHTING_THRESHOLDS = {
  lowLuminance: 0.18,
  maxBacklitHandLuminance: 0.28,
  minBackgroundContrast: 0.25,
} as const;
export interface LightingStats {
  /** Rec. 709 weighted RGB luminance, normalized to 0..1 (no gamma correction). */
  meanLuminance: number;
  handLuminance: number | null;
  backgroundLuminance: number | null;
  status: 'good' | 'low_light' | 'backlit';
}
export interface VisionDiagnostics {
  lighting: LightingStats | null;
  /** null when absent, unrecognized or in the legacy diagonal view. */
  handednessMismatch: boolean | null;
}
export function lightingStatus(
  mean: number,
  hand: number | null,
  background: number | null,
): LightingStats['status'] {
  const limits = LIGHTING_THRESHOLDS;
  if (
    hand !== null &&
    background !== null &&
    hand < limits.maxBacklitHandLuminance &&
    background - hand >= limits.minBackgroundContrast
  )
    return 'backlit';
  return (hand ?? mean) < limits.lowLuminance ? 'low_light' : 'good';
}

/** Uses the hand bounding box as a region estimate, not skin segmentation. */
export function measureLighting(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  landmarks: Landmark[] | null,
): LightingStats | null {
  if (width < 1 || height < 1 || pixels.length !== width * height * 4)
    return null;
  const valid =
    landmarks?.length === 21 &&
    landmarks.every(
      (p) =>
        p.every(Number.isFinite) &&
        p[0] >= 0 &&
        p[0] <= 1 &&
        p[1] >= 0 &&
        p[1] <= 1,
    );
  const xs = valid ? landmarks.map((p) => p[0] * width) : [];
  const ys = valid ? landmarks.map((p) => p[1] * height) : [];
  const left = Math.floor(Math.min(...xs)),
    right = Math.ceil(Math.max(...xs));
  const top = Math.floor(Math.min(...ys)),
    bottom = Math.ceil(Math.max(...ys));
  let total = 0,
    hand = 0,
    handCount = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const luminance =
        (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) /
        255;
      total += luminance;
      if (valid && x >= left && x < right && y >= top && y < bottom) {
        hand += luminance;
        handCount++;
      }
    }
  const count = width * height;
  const meanLuminance = total / count;
  const handLuminance = handCount ? hand / handCount : null;
  const backgroundLuminance =
    handCount && handCount < count
      ? (total - hand) / (count - handCount)
      : null;
  return {
    meanLuminance,
    handLuminance,
    backgroundLuminance,
    status: lightingStatus(meanLuminance, handLuminance, backgroundLuminance),
  };
}

/** Small reusable canvas; failures leave exposure unknown without stopping tracking. */
export class VideoLightingSampler {
  private canvas: HTMLCanvasElement | null = null;
  sample(
    video: HTMLVideoElement,
    landmarks: Landmark[] | null,
  ): LightingStats | null {
    if (!video.videoWidth || !video.videoHeight) return null;
    try {
      if (!this.canvas) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 64;
        this.canvas.height = 48;
      }
      const context = this.canvas.getContext('2d', {
        willReadFrequently: true,
      });
      if (!context) return null;
      context.drawImage(video, 0, 0, 64, 48);
      return measureLighting(
        context.getImageData(0, 0, 64, 48).data,
        64,
        48,
        landmarks,
      );
    } catch {
      return null;
    }
  }
}
