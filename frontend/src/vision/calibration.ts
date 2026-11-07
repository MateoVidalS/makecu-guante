import {
  VISION_LOW_CONFIDENCE,
  type VisionFrame,
  type FingerId,
} from '../contracts/vision';
import { FINGERS, fingerMap } from './flex';
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b),
    mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Latest continuous window for all five fingers, including glove-closed ring/pinky.
 * Rejects missing hands, hand changes, sparse captures and movement.
 */
export function captureStats(
  frames: VisionFrame[],
  seconds: number,
): { rawFlexSum: Record<FingerId, number>; pinch: number } {
  if (!Number.isFinite(seconds) || seconds <= 0 || !frames.length)
    throw new Error('Capture a complete hold-still window');
  const end = frames.at(-1)!.t,
    duration = seconds * 1000;
  if (!Number.isFinite(end)) throw new Error('Invalid capture timestamp');
  const window = frames.filter((f) => f.t >= end - duration);
  // Allow one 30Hz frame of boundary rounding, but no missing intervals >100ms.
  if (
    window.length < Math.ceil(seconds * 15) ||
    end - window[0].t < duration - 40
  )
    throw new Error('Hold still for the full capture');
  window.forEach((f, i) => {
    if (
      !Number.isFinite(f.t) ||
      (i > 0 && (f.t <= window[i - 1].t || f.t - window[i - 1].t > 100)) ||
      !f.detected ||
      !Number.isFinite(f.confidence) ||
      f.confidence < VISION_LOW_CONFIDENCE ||
      f.handedness === null ||
      f.handedness !== window[0].handedness ||
      !f.rawFlexSum ||
      f.pinch === null ||
      !Number.isFinite(f.pinch) ||
      !FINGERS.every((finger) => Number.isFinite(f.rawFlexSum![finger]))
    )
      throw new Error('Keep your hand visible throughout the capture');
  });
  const rawFlexSum = fingerMap((finger) => {
    const values = window.map((f) => f.rawFlexSum![finger]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const std = Math.sqrt(
      values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length,
    );
    if (std > 8) throw new Error("Too much movement — let's try again");
    return median(values);
  });
  return { rawFlexSum, pinch: median(window.map((f) => f.pinch!)) };
}
