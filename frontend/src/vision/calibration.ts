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

/**
 * Hold-still rule for camera calibration captures (the Calibrate page uses it as is).
 *
 * - Gaps: the hand may be missed for less than `maxGapMs` at a time, the same gap the
 *   engine's reach dwell tolerates and after which FrameProcessor resets its filters.
 *   Missed frames never enter the medians.
 * - Noise: each finger's smoothed flex sum may vary by at most `maxStdDeg` (std over
 *   the window; docs/plan/05 B3). Severe camera noise is refused.
 * - Movement: each finger's median over the first third of the hold and over the last
 *   third may differ by at most `maxShiftDeg` (thumb: `maxThumbShiftDeg`; it has about a
 *   third of a long finger's range). This refuses a drift or a finger closing or opening
 *   during the hold, which the median would turn into a wrong range. A brief twitch
 *   or glitch in the middle does not move the median, so it does not count.
 * Measured in src/vision/perf/calibrationCapture.test.ts.
 */
export const CAPTURE_RULE = {
  maxGapMs: 200,
  minSeenPerSecond: 10,
  maxStdDeg: 8,
  maxShiftDeg: 14,
  maxThumbShiftDeg: 8,
  maxPinchShift: 0.08,
} as const;

export type CaptureFailure = 'window' | 'visibility' | 'movement';
/** Why a capture was refused: an incomplete window, the hand not seen, or movement/noise. */
export class CaptureError extends Error {
  constructor(
    readonly reason: CaptureFailure,
    message: string,
  ) {
    super(message);
    this.name = 'CaptureError';
  }
}

/** A frame that measured the hand: detected, confident and with finite values. */
function measured(f: VisionFrame): boolean {
  return (
    f.detected &&
    Number.isFinite(f.confidence) &&
    f.confidence >= VISION_LOW_CONFIDENCE &&
    f.handedness !== null &&
    !!f.rawFlexSum &&
    FINGERS.every((finger) => Number.isFinite(f.rawFlexSum![finger])) &&
    f.pinch !== null &&
    Number.isFinite(f.pinch) &&
    f.pinch >= 0
  );
}

/** Latest continuous window for all five fingers, including glove-closed ring/pinky.
 * Rejects incomplete windows, a hand that is lost or changes, sparse captures, noise and movement.
 */
export function captureStats(
  frames: VisionFrame[],
  seconds: number,
): { rawFlexSum: Record<FingerId, number>; pinch: number } {
  if (!Number.isFinite(seconds) || seconds <= 0 || !frames.length)
    throw new CaptureError('window', 'Capture a complete hold-still window');
  const end = frames.at(-1)!.t,
    duration = seconds * 1000,
    start = end - duration;
  if (!Number.isFinite(end))
    throw new CaptureError('window', 'Invalid capture timestamp');
  const window = frames.filter((f) => f.t >= start);
  // Allow one 30Hz frame of boundary rounding.
  if (end - window[0].t < duration - 40)
    throw new CaptureError('window', 'Hold still for the full capture');
  if (
    window.some(
      (f, i) => !Number.isFinite(f.t) || (i > 0 && f.t <= window[i - 1].t),
    )
  )
    throw new CaptureError('window', 'Invalid capture timestamp');
  const seen = window.filter(measured);
  const lost = () =>
    new CaptureError(
      'visibility',
      'Keep your hand visible throughout the capture',
    );
  if (
    seen.length < Math.ceil(seconds * CAPTURE_RULE.minSeenPerSecond) ||
    seen.some((f) => f.handedness !== seen[0].handedness)
  )
    throw lost();
  const times = [start, ...seen.map((f) => f.t), end];
  if (times.some((t, i) => i > 0 && t - times[i - 1] >= CAPTURE_RULE.maxGapMs))
    throw lost();
  const first = seen.filter((f) => f.t < start + duration / 3),
    last = seen.filter((f) => f.t > end - duration / 3);
  if (!first.length || !last.length) throw lost();
  const moved = () =>
    new CaptureError('movement', "Too much movement — let's try again");
  const shift = (value: (f: VisionFrame) => number) =>
    Math.abs(median(first.map(value)) - median(last.map(value)));
  const rawFlexSum = fingerMap((finger) => {
    const value = (f: VisionFrame) => f.rawFlexSum![finger];
    const values = seen.map(value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const std = Math.sqrt(
      values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length,
    );
    const limit =
      finger === 'thumb'
        ? CAPTURE_RULE.maxThumbShiftDeg
        : CAPTURE_RULE.maxShiftDeg;
    if (std > CAPTURE_RULE.maxStdDeg || shift(value) > limit) throw moved();
    return median(values);
  });
  if (shift((f) => f.pinch!) > CAPTURE_RULE.maxPinchShift) throw moved();
  return { rawFlexSum, pinch: median(seen.map((f) => f.pinch!)) };
}
