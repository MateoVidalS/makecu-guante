import type { PointRegion } from './deviceInpaintPoints';

/**
 * `straps` variant of deviceInpaint.ts. The user's device wraps black velcro
 * straps around every finger segment and
 * the wrist, with yellow/orange thread guides and orange cables on top. On
 * recordings of it MediaPipe almost never finds the hand: the straps cut every
 * finger into short pieces. This fill paints each strap pixel that has solid
 * skin on both sides within a strap's width (along a row, a column or a
 * diagonal) with a blend of those two skin colours, so the fingers read as
 * continuous skin again. Pixels farther from skin are left alone, so wider dark
 * areas (the gaps between spread fingers over a black sweater, the sweater
 * itself) keep their colour.
 *
 * It also paints dark spots elsewhere when skin surrounds them closely (glasses
 * frames, hair edges, a dark gap between fingers narrower than a strap), so it
 * should only run when the device is chosen or recognised (deviceCoverage).
 */

/** Pixels at 640 px frame width; scaled with the frame. */
export const STRAP_TUNING = {
  /**
   * Longest skin-to-skin span that is filled: about a strap's width plus its
   * guide on an upright hand 40–60 cm from a laptop webcam. Tuned on three real
   * recordings of the device (r5–r7): 18 found fewer hands, 34–44 more on one
   * recording but fewer on the two upright ones.
   */
  span: 26,
  /**
   * Skin must be at least this bright (red channel): the straps' blended edges
   * and a dark sweater's brownish pixels are not skin. Very dark skin in dim
   * light may not pass; then nothing is filled.
   */
  minSkinRed: 100,
  /** Colours are taken this many pixels inside the skin, past any shading at its edge. */
  depth: 3,
} as const;

/**
 * Bright skin, light or warm-lit; the hue band and saturation cap keep the
 * yellow guides, orange cables and wood out.
 */
function isStrapSkin(r: number, g: number, b: number): boolean {
  if (r < STRAP_TUNING.minSkinRed || r < g || r < b) return false;
  const min = g < b ? g : b;
  const delta = r - min;
  if (delta < 0.12 * r || delta > 0.65 * r) return false;
  const hue = (60 * (g - b)) / delta;
  return hue <= 38 && hue >= -15;
}

/**
 * Part of the device: a black strap (dark, not strongly coloured), a yellow
 * guide, or an orange guide or cable (more saturated than skin).
 */
export function isDevicePixel(r: number, g: number, b: number): boolean {
  const max = r > g ? (r > b ? r : b) : g > b ? g : b;
  const min = r < g ? (r < b ? r : b) : g < b ? g : b;
  const delta = max - min;
  if (max <= 90) return delta <= 0.45 * max || max <= 32;
  if (delta < 0.5 * max || max === b) return false;
  const hue = max === r ? (60 * (g - b)) / delta : 60 * ((b - r) / delta + 2);
  if (hue >= 42 && hue <= 75) return true;
  return hue >= 5 && hue < 42 && delta >= 0.66 * max;
}

/** Reusable per-pixel buffers. */
export interface StrapScratch {
  /** Half-resolution copy of the frame and its filled version. */
  small: Uint8ClampedArray;
  smallOut: Uint8ClampedArray;
  skin: Uint8Array;
  fill: Uint8Array;
  best: Uint8Array;
  before: Uint8Array;
  after: Uint8Array;
  beforeAt: Int32Array;
  afterAt: Int32Array;
}
export function createStrapScratch(): StrapScratch {
  return {
    small: new Uint8ClampedArray(0),
    smallOut: new Uint8ClampedArray(0),
    skin: new Uint8Array(0),
    fill: new Uint8Array(0),
    best: new Uint8Array(0),
    before: new Uint8Array(0),
    after: new Uint8Array(0),
    beforeAt: new Int32Array(0),
    afterAt: new Int32Array(0),
  };
}

const FAR = 255;
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/**
 * Copies `src` (RGBA) to `dst` with device pixels between nearby skin painted
 * over (`dst` may be `src`). Only `region` is changed (default: the whole
 * frame). Frames 480 px wide or more are processed at half resolution (a
 * strap is still ~13 px wide there; MediaPipe itself looks at ~200 px), which
 * makes it about four times cheaper. Returns the number of pixels painted.
 */
export function fillDeviceStraps(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  width: number,
  height: number,
  scratch: StrapScratch = createStrapScratch(),
  region?: PointRegion,
): number {
  const pixels = width * height;
  if (!pixels || src.length < pixels * 4 || dst.length < pixels * 4) return 0;
  if (dst !== src) dst.set(src.subarray(0, pixels * 4));
  const span = (STRAP_TUNING.span * width) / 640;
  if (width < 480)
    return fillAt(src, dst, width, height, scratch, span, region);
  // Half resolution: average 2×2 blocks, fill, then copy painted blocks back.
  const w = width >> 1,
    h = height >> 1;
  if (scratch.small.length !== w * h * 4) {
    scratch.small = new Uint8ClampedArray(w * h * 4);
    scratch.smallOut = new Uint8ClampedArray(w * h * 4);
  }
  const { small, smallOut } = scratch;
  const r = region && {
    x0: Math.floor(region.x0 / 2),
    y0: Math.floor(region.y0 / 2),
    x1: Math.ceil(region.x1 / 2),
    y1: Math.ceil(region.y1 / 2),
  };
  const sx0 = Math.max(0, r?.x0 ?? 0),
    sy0 = Math.max(0, r?.y0 ?? 0),
    sx1 = Math.min(w, r?.x1 ?? w),
    sy1 = Math.min(h, r?.y1 ?? h);
  for (let y = sy0; y < sy1; y++)
    for (let x = sx0; x < sx1; x++) {
      const o = (y * w + x) * 4,
        a = (2 * y * width + 2 * x) * 4,
        b = a + width * 4;
      for (let c = 0; c < 3; c++)
        small[o + c] = smallOut[o + c] =
          (src[a + c] + src[a + 4 + c] + src[b + c] + src[b + 4 + c] + 2) >> 2;
    }
  const painted = fillAt(small, smallOut, w, h, scratch, span / 2, r);
  if (!painted) return 0;
  const { best } = scratch;
  for (let y = sy0; y < sy1; y++)
    for (let x = sx0; x < sx1; x++) {
      const q = y * w + x;
      if (best[q] === FAR) continue;
      const o = q * 4;
      for (const a of [
        (2 * y * width + 2 * x) * 4,
        (2 * y * width + 2 * x + 1) * 4,
        ((2 * y + 1) * width + 2 * x) * 4,
        ((2 * y + 1) * width + 2 * x + 1) * 4,
      ]) {
        dst[a] = smallOut[o];
        dst[a + 1] = smallOut[o + 1];
        dst[a + 2] = smallOut[o + 2];
      }
    }
  return painted * 4;
}

/** The fill at the given resolution; `best[p] < FAR` marks painted pixels. */
function fillAt(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  width: number,
  height: number,
  scratch: StrapScratch,
  spanPx: number,
  region?: PointRegion,
): number {
  const pixels = width * height;
  const x0 = Math.max(0, Math.floor(region?.x0 ?? 0)),
    y0 = Math.max(0, Math.floor(region?.y0 ?? 0)),
    x1 = Math.min(width, Math.ceil(region?.x1 ?? width)),
    y1 = Math.min(height, Math.ceil(region?.y1 ?? height));
  if (x1 - x0 < 3 || y1 - y0 < 3) return 0;
  const span = Math.min(FAR - 1, Math.max(3, Math.round(spanPx)));
  if (scratch.skin.length !== pixels) {
    scratch.skin = new Uint8Array(pixels);
    scratch.fill = new Uint8Array(pixels);
    scratch.best = new Uint8Array(pixels);
    scratch.before = new Uint8Array(pixels);
    scratch.after = new Uint8Array(pixels);
    scratch.beforeAt = new Int32Array(pixels);
    scratch.afterAt = new Int32Array(pixels);
  }
  const { skin, fill, best, before, after, beforeAt, afterAt } = scratch;
  // 1. Skin and device pixels in the region (fill = 1 marks device pixels).
  for (let y = y0; y < y1; y++)
    for (let p = y * width + x0, end = y * width + x1; p < end; p++) {
      const i = p * 4;
      const r = src[i],
        g = src[i + 1],
        b = src[i + 2];
      skin[p] = isStrapSkin(r, g, b) ? 1 : 0;
      fill[p] = !skin[p] && isDevicePixel(r, g, b) ? 1 : 0;
    }
  // 2. Colours come from solid skin only (all 8 neighbours skin), so a
  // strap's blended edge is not copied. Edges and strap texture next to a
  // device pixel are painted too.
  for (let y = y0; y < y1; y++)
    for (let x = x0, p = y * width + x0; x < x1; x++, p++) {
      let solid = skin[p],
        nearDevice = fill[p];
      if (y === y0 || y === y1 - 1 || x === x0 || x === x1 - 1) solid = 0;
      else
        for (let dy = -width; dy <= width; dy += width)
          for (let dx = -1; dx <= 1; dx++) {
            const q = p + dy + dx;
            if (!(skin[q] & 1)) solid = 0;
            if (fill[q] & 1) nearDevice = 1;
          }
      // Bit 1 keeps the first pass's value for the neighbours still to come.
      skin[p] = (skin[p] & 1) | (solid << 1);
      fill[p] = (fill[p] & 1) | ((!solid && nearDevice ? 1 : 0) << 1);
    }
  for (let y = y0; y < y1; y++)
    for (let p = y * width + x0, end = y * width + x1; p < end; p++) {
      skin[p] >>= 1;
      fill[p] >>= 1;
      best[p] = FAR;
    }
  const inside = (q: number) => {
    const qy = (q / width) | 0,
      qx = q - qy * width;
    return q >= 0 && qy >= y0 && qy < y1 && qx >= x0 && qx < x1;
  };
  // 3. Along each direction, the nearest solid skin before and after each pixel.
  let painted = 0;
  for (const [dy, dx] of DIRECTIONS) {
    const step = dy * width + dx;
    for (let y = y0; y < y1; y++)
      for (let k = x0; k < x1; k++) {
        const x = dx >= 0 ? k : x0 + x1 - 1 - k;
        const p = y * width + x;
        if (skin[p]) {
          before[p] = 0;
          beforeAt[p] = p;
          continue;
        }
        const py = y - dy,
          px = x - dx;
        if (py < y0 || px < x0 || px >= x1 || before[p - step] >= FAR - 1) {
          before[p] = FAR;
          continue;
        }
        before[p] = before[p - step] + 1;
        beforeAt[p] = beforeAt[p - step];
      }
    for (let y = y1 - 1; y >= y0; y--)
      for (let k = x0; k < x1; k++) {
        const x = dx >= 0 ? x0 + x1 - 1 - k : k;
        const p = y * width + x;
        if (skin[p]) {
          after[p] = 0;
          afterAt[p] = p;
          continue;
        }
        const ny = y + dy,
          nx = x + dx;
        if (ny >= y1 || nx < x0 || nx >= x1 || after[p + step] >= FAR - 1) {
          after[p] = FAR;
          continue;
        }
        after[p] = after[p + step] + 1;
        afterAt[p] = afterAt[p + step];
      }
    // 4. Paint device pixels across the shortest skin-to-skin span.
    for (let y = y0; y < y1; y++)
      for (let p = y * width + x0, end = y * width + x1; p < end; p++) {
        if (!fill[p]) continue;
        const total = before[p] + after[p];
        if (total > span || total >= best[p]) continue;
        if (best[p] === FAR) painted++;
        best[p] = total;
        // Sample a few pixels deeper into the skin on both sides.
        let pa = beforeAt[p],
          pb = afterAt[p];
        for (let d = 0; d < STRAP_TUNING.depth; d++) {
          if (inside(pa - step) && skin[pa - step]) pa -= step;
          if (inside(pb + step) && skin[pb + step]) pb += step;
        }
        const t = before[p] / total,
          a = pa * 4,
          b = pb * 4,
          o = p * 4;
        dst[o] = src[a] + (src[b] - src[a]) * t;
        dst[o + 1] = src[a + 1] + (src[b + 1] - src[a + 1]) * t;
        dst[o + 2] = src[a + 2] + (src[b + 2] - src[a + 2]) * t;
      }
  }
  return painted;
}
