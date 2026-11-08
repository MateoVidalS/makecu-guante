import type { Landmark } from './flex';

/**
 * MediaPipe's palm detector is trained on bare skin, so a uniformly coloured
 * glove (violet, sky blue, magenta, black) is often not found at all. Before inference
 * we repaint pixels of the glove colour in a skin tone, keeping their shading,
 * so the detector sees a hand-shaped, skin-coloured silhouette. The preview
 * video is never changed; only the copy given to MediaPipe is. Which colour is
 * repainted, and when, is decided by the device profiles (deviceProfiles.ts).
 */
export type GloveColor = 'none' | 'violet' | 'sky-blue' | 'magenta' | 'black';

/**
 * Default target tone and brightness, tuned on synthetic black, sky blue and
 * magenta gloves (several poses and hand sizes): a mid tan at 0.7 of the glove's
 * mean brightness detected every case, while a lighter tone lost some.
 */
const TAN = [180, 120, 85] as const;
const PALE = [240, 200, 175] as const;
const MIN_SHADE = 0.3;
const MAX_SHADE = 1.3;

/**
 * How each colour turns glove brightness into skin shading.
 * - `channel`: brightness is the brightest channel, or the channel average (less noise).
 * - `smoothing`: box-blur radius at 640 px width, averaging glove pixels only.
 * - `contrast`: power applied to brightness / mean brightness.
 * - `fill`: radius at 640 px width within which darker "shadow" pixels of the
 *   glove colour (isGloveShadowPixel) are also repainted, filling folds.
 * A really black glove sits near 0–15 of 255, where sensor noise is as large as
 * its real shading: unsmoothed it becomes speckle and is rarely detected.
 * Averaged, smoothed and contrast-stretched, the faint folds come back. Tuned on
 * synthetic gloves from dark grey (30/255) to near-pure black (3/255) with
 * camera noise: 40/40 detected (36/40 with heavy noise), versus 15/40 (1/40)
 * with plain shading. Sky blue and magenta are bright enough not to need it.
 * Violet was tuned on four rounds of real webcam frames of a lavender nitrile
 * glove (two places, navy and black shirts, open/fist/side and palm-down poses,
 * the hand in front of the other bare forearm). A light, bright repaint was best
 * every round (a darker tone lost the hand against bare skin behind it); filling
 * shadowed folds lifted the hardest round from 29/60 to 52/60 with no loss
 * elsewhere (rounds 3+4: 82/120 → 105/120; raw: 3/120).
 * Finger accuracy was then tuned on the rendered-hand bench (known joint angles,
 * upright view) with a glove-coloured hand: a uniform repaint flattened the thumb
 * against the palm (calibrated thumb range 32° vs 59° bare). A mild contrast
 * power of 1.5 at 1.0× restores it (55°; thumb error 0.13 = bare) and also finds
 * more hands on the real frames (111/120). Contrast 2 or edge sharpening broke
 * calibration; the bench's own skin tone did well there but badly on real frames.
 */
const TUNING: Record<
  Exclude<GloveColor, 'none'>,
  {
    channel: 'max' | 'mean';
    smoothing: number;
    contrast: number;
    tone: readonly [number, number, number];
    gain: number;
    fill: number;
  }
> = {
  violet: {
    channel: 'max',
    smoothing: 0,
    contrast: 1.5,
    tone: PALE,
    gain: 1,
    fill: 8,
  },
  'sky-blue': {
    channel: 'max',
    smoothing: 0,
    contrast: 1,
    tone: TAN,
    gain: 0.7,
    fill: 0,
  },
  magenta: {
    channel: 'max',
    smoothing: 0,
    contrast: 1,
    tone: TAN,
    gain: 0.7,
    fill: 0,
  },
  black: {
    channel: 'mean',
    smoothing: 5,
    contrast: 2,
    tone: TAN,
    gain: 0.7,
    fill: 0,
  },
};

/** Whether an RGB pixel (0–255) looks like the glove colour. */
export function isGlovePixel(
  color: Exclude<GloveColor, 'none'>,
  r: number,
  g: number,
  b: number,
): boolean {
  const max = r > g ? (r > b ? r : b) : g > b ? g : b;
  const min = r < g ? (r < b ? r : b) : g < b ? g : b;
  const delta = max - min;
  // HSV value and saturation without division: value 0.30 ≈ 76/255, 0.12 ≈ 30/255.
  if (color === 'black')
    // Dark and not strongly coloured: excludes shadowed skin, which stays saturated.
    return max <= 76 && (delta <= 0.45 * max || max <= 30);
  if (max === 0 || delta === 0) return false;
  let hue: number;
  if (max === r) hue = (60 * (g - b)) / delta;
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);
  if (hue < 0) hue += 360;
  if (color === 'violet')
    // Lavender/periwinkle nitrile, measured on a laptop webcam under office light:
    // hue 228–244°, saturation 0.3–0.5, value 0.4–0.6. Navy clothing is excluded
    // by hue (≤ 223°) and by being more saturated (≥ 0.6 typically).
    return (
      hue >= 224 &&
      hue <= 268 &&
      delta >= 0.15 * max &&
      delta <= 0.6 * max &&
      max >= 71
    );
  if (color === 'sky-blue')
    return hue >= 165 && hue <= 255 && delta >= 0.15 * max && max >= 30;
  return hue >= 265 && hue <= 350 && delta >= 0.18 * max && max >= 26;
}

/**
 * Darker, more saturated pixels of the glove colour: folds and the shadowed side
 * of the hand. Too broad on their own (navy clothing passes), so they are only
 * repainted near confident glove pixels; see TUNING `fill`.
 */
export function isGloveShadowPixel(
  color: Exclude<GloveColor, 'none'>,
  r: number,
  g: number,
  b: number,
): boolean {
  if (color !== 'violet') return false;
  const max = r > g ? (r > b ? r : b) : g > b ? g : b;
  const min = r < g ? (r < b ? r : b) : g < b ? g : b;
  const delta = max - min;
  if (max < 38 || delta < 0.15 * max || delta > 0.85 * max) return false;
  let hue: number;
  if (max === r) hue = (60 * (g - b)) / delta;
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);
  if (hue < 0) hue += 360;
  return hue >= 220 && hue <= 268;
}

/** Reusable per-pixel buffers, so recolouring allocates nothing per frame. */
export interface RecolorScratch {
  mask: Uint8Array;
  value: Float32Array;
  weight: Float32Array;
  smoothValue: Float32Array;
  smoothWeight: Float32Array;
  row: Float32Array;
}
export function createRecolorScratch(): RecolorScratch {
  return {
    mask: new Uint8Array(0),
    value: new Float32Array(0),
    weight: new Float32Array(0),
    smoothValue: new Float32Array(0),
    smoothWeight: new Float32Array(0),
    row: new Float32Array(0),
  };
}
function fit(scratch: RecolorScratch, pixels: number, side: number) {
  if (scratch.mask.length !== pixels) {
    scratch.mask = new Uint8Array(pixels);
    scratch.value = new Float32Array(pixels);
    scratch.weight = new Float32Array(pixels);
    scratch.smoothValue = new Float32Array(pixels);
    scratch.smoothWeight = new Float32Array(pixels);
  }
  if (scratch.row.length < side) scratch.row = new Float32Array(side);
}

/**
 * Box sum over a (2r+1)² window with edges clamped, written to `dst`.
 * Unnormalised: callers divide two sums taken over the same window.
 */
function boxSum(
  src: Float32Array,
  dst: Float32Array,
  row: Float32Array,
  width: number,
  height: number,
  r: number,
) {
  for (let y = 0; y < height; y++) {
    const o = y * width;
    let sum = 0;
    for (let x = -r; x <= r; x++)
      sum += src[o + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x++) {
      dst[o + x] = sum;
      sum +=
        src[o + Math.min(width - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) row[y] = dst[y * width + x];
    let sum = 0;
    for (let y = -r; y <= r; y++)
      sum += row[Math.min(height - 1, Math.max(0, y))];
    for (let y = 0; y < height; y++) {
      dst[y * width + x] = sum;
      sum += row[Math.min(height - 1, y + r + 1)] - row[Math.max(0, y - r)];
    }
  }
}

/**
 * Copies RGBA `src` into `dst`, repainting glove-coloured pixels in a skin tone.
 * Each repainted pixel keeps its brightness relative to the glove's mean in this
 * frame, so folds and knuckles stay visible. Returns the fraction repainted.
 */
export function recolorGlove(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  width: number,
  height: number,
  color: Exclude<GloveColor, 'none'>,
  scratch: RecolorScratch = createRecolorScratch(),
): number {
  const pixels = width * height;
  if (!pixels || src.length < pixels * 4) return 0;
  fit(scratch, pixels, Math.max(width, height));
  const { mask, value, weight, smoothValue, smoothWeight } = scratch;
  const { channel, smoothing, contrast, tone, gain, fill } = TUNING[color];
  let sum = 0,
    count = 0;
  for (let p = 0, i = 0; p < pixels; p++, i += 4) {
    const r = src[i],
      g = src[i + 1],
      b = src[i + 2];
    dst[i] = r;
    dst[i + 1] = g;
    dst[i + 2] = b;
    dst[i + 3] = src[i + 3];
    if (isGlovePixel(color, r, g, b)) {
      const v =
        channel === 'mean'
          ? (r + g + b) / 3
          : r > g
            ? r > b
              ? r
              : b
            : g > b
              ? g
              : b;
      mask[p] = 1;
      value[p] = v;
      weight[p] = 1;
      sum += v;
      count++;
    } else {
      mask[p] = 0;
      value[p] = 0;
      weight[p] = 0;
    }
  }
  if (!count) return 0;
  if (fill > 0) {
    // Accept shadow pixels with a confident glove pixel within the fill radius.
    const reach = Math.max(1, Math.round((fill * width) / 640));
    boxSum(weight, smoothWeight, scratch.row, width, height, reach);
    for (let p = 0, i = 0; p < pixels; p++, i += 4) {
      if (mask[p] || smoothWeight[p] <= 0) continue;
      const r = src[i],
        g = src[i + 1],
        b = src[i + 2];
      if (!isGloveShadowPixel(color, r, g, b)) continue;
      const v =
        channel === 'mean'
          ? (r + g + b) / 3
          : r > g
            ? r > b
              ? r
              : b
            : g > b
              ? g
              : b;
      mask[p] = 1;
      value[p] = v;
      sum += v;
      count++;
    }
    // Smoothing (if any) should average the filled pixels too.
    for (let p = 0; p < pixels; p++) weight[p] = mask[p];
  }
  // Half a count keeps the ratio finite (and neutral) for a glove crushed to 0.
  const mean = sum / count + 0.5;
  const radius =
    smoothing > 0 ? Math.max(1, Math.round((smoothing * width) / 640)) : 0;
  if (radius) {
    boxSum(value, smoothValue, scratch.row, width, height, radius);
    boxSum(weight, smoothWeight, scratch.row, width, height, radius);
  }
  for (let p = 0, i = 0; p < pixels; p++, i += 4) {
    if (!mask[p]) continue;
    // Average over glove pixels only, so the bright background does not bleed in.
    const v = radius ? smoothValue[p] / smoothWeight[p] : value[p];
    const ratio = (v + 0.5) / mean;
    let k =
      gain *
      (contrast === 1
        ? ratio
        : contrast === 1.5
          ? ratio * Math.sqrt(ratio)
          : contrast === 2
            ? ratio * ratio
            : ratio ** contrast);
    k = k < MIN_SHADE ? MIN_SHADE : k > MAX_SHADE ? MAX_SHADE : k;
    dst[i] = tone[0] * k;
    dst[i + 1] = tone[1] * k;
    dst[i + 2] = tone[2] * k;
  }
  return count / pixels;
}

/** Landmark pairs whose midpoints lie inside the hand (bones of the hand skeleton). */
const BONES: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]; // prettier-ignore

/**
 * Fraction of points on the detected hand whose colour in the original frame
 * (3×3 average) matches the glove colour. Low coverage means the hand found
 * through recolouring is not actually wearing that glove.
 */
export function gloveCoverage(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  landmarks: readonly Landmark[],
  color: Exclude<GloveColor, 'none'>,
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
    if (isGlovePixel(color, r / n, g / n, b / n)) matched++;
  }
  return inside ? matched / inside : 0;
}
