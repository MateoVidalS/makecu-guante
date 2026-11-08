import type { Landmark } from './flex';
import {
  createPointScratch,
  pointKind,
  removeHandPoints,
  type PointRegion,
  type PointScratch,
} from './deviceInpaintPoints';
import {
  createStrapScratch,
  fillDeviceStraps,
  isDevicePixel,
  type StrapScratch,
} from './deviceInpaintStraps';

/**
 * Paints over the device on a bare hand before inference, so MediaPipe sees a
 * plain hand. Same calling style as gloveColor's recolorGlove: pure, no DOM,
 * reusable scratch buffers, the preview video is never changed.
 *
 * - `straps`: the user's device (black velcro straps on every finger segment and
 *   the wrist, yellow/orange thread guides, orange cables). Each device pixel
 *   with solid skin on both sides within a strap's width is filled with a blend
 *   of that skin (deviceInpaintStraps.ts). Only for a hand wearing the device:
 *   it also fills dark spots that skin closely surrounds elsewhere (glasses,
 *   hair edges, narrow dark gaps between fingers).
 * - `points`: the team's small black dorsal guides and yellow fingertip anchors.
 *   Small compact dark or yellow blobs on skin are painted from their
 *   surroundings (deviceInpaintPoints.ts). Safe on frames without points: it
 *   then changes nothing.
 */
export type DeviceVariant = 'straps' | 'points';
export const DEVICE_VARIANTS: readonly DeviceVariant[] = ['straps', 'points'];
export type { PointRegion } from './deviceInpaintPoints';
export { STRAP_TUNING } from './deviceInpaintStraps';
export { POINT_TUNING } from './deviceInpaintPoints';

export interface DeviceScratch {
  points: PointScratch;
  straps: StrapScratch;
}
export function createDeviceScratch(): DeviceScratch {
  return { points: createPointScratch(), straps: createStrapScratch() };
}

/**
 * Copies RGBA `src` into `dst` (which may be `src`) with the device painted
 * over, and returns the fraction of pixels changed (0 when nothing was found:
 * `dst` is then an exact copy, so the raw video can be used instead).
 * `region` limits the work to a rectangle, e.g. the tracked hand's box widened
 * by a third of its size; that is also much cheaper than the whole frame.
 */
export function inpaintDevice(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  width: number,
  height: number,
  variant: DeviceVariant,
  scratch: DeviceScratch = createDeviceScratch(),
  region?: PointRegion,
): number {
  const pixels = width * height;
  if (!pixels || src.length < pixels * 4 || dst.length < pixels * 4) return 0;
  if (variant === 'straps')
    return (
      fillDeviceStraps(src, dst, width, height, scratch.straps, region) / pixels
    );
  if (dst !== src) dst.set(src.subarray(0, pixels * 4));
  removeHandPoints(dst, dst, width, height, scratch.points, { region });
  return scratch.points.painted / pixels;
}

/** Whether a pixel looks like the given device (strap/guide, or a point). */
export function isDevicePixelOf(
  variant: DeviceVariant,
  r: number,
  g: number,
  b: number,
): boolean {
  return variant === 'straps' ? isDevicePixel(r, g, b) : pointKind(r, g, b) > 0;
}

/** Landmark pairs whose midpoints lie inside the hand (as in gloveColor.ts). */
const BONES: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]; // prettier-ignore

/**
 * Share of the detected hand's skeleton points (landmarks and bone midpoints,
 * 3×3 average of the original frame) that look like the device; same style as
 * gloveColor's gloveCoverage. For `straps` it was 0.24–0.29 (median; 10th
 * percentile 0.07–0.24) on the device hand in three real recordings, and about 0
 * on a bare hand, so ~0.1 separates them. The `points` are too small to cover
 * skeleton points (near 0 even when worn); since that variant changes nothing
 * on a hand without points, it can simply always run.
 */
export function deviceCoverage(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  landmarks: readonly Landmark[],
  variant: DeviceVariant,
): number {
  if (landmarks.length !== 21 || width < 1 || height < 1) return 0;
  const points: [number, number][] = landmarks.map(([x, y]) => [x, y]);
  for (const [a, b] of BONES)
    points.push([
      (landmarks[a][0] + landmarks[b][0]) / 2,
      (landmarks[a][1] + landmarks[b][1]) / 2,
    ]);
  let inside = 0,
    matched = 0;
  for (const [nx, ny] of points) {
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
    const cx = Math.round(nx * (width - 1)),
      cy = Math.round(ny * (height - 1));
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
    let r = 0,
      g = 0,
      b = 0,
      n = 0;
    for (let y = Math.max(0, cy - 1); y <= Math.min(height - 1, cy + 1); y++)
      for (let x = Math.max(0, cx - 1); x <= Math.min(width - 1, cx + 1); x++) {
        const i = (y * width + x) * 4;
        r += pixels[i];
        g += pixels[i + 1];
        b += pixels[i + 2];
        n++;
      }
    inside++;
    if (isDevicePixelOf(variant, r / n, g / n, b / n)) matched++;
  }
  return inside ? matched / inside : 0;
}
