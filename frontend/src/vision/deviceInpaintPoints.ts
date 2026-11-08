/**
 * `points` variant of deviceInpaint.ts: small black thread guides and yellow
 * fingertip anchors taped to the back of a bare hand. MediaPipe's palm detector
 * was trained on plain hands: when the fingers curl, the points turn toward the
 * camera and a fist is often not found at all. We find small, compact dark or
 * yellow blobs on the skin and paint over them from their surroundings, so the
 * detector sees a plain bare hand.
 *
 * It is meant to be safe on any frame: a blob must be small, compact, touch
 * skin, and (for a dark guide) be much darker than everything around it, so
 * creases, finger gaps, sleeves and dark backgrounds are left alone. When
 * nothing is found `dst` is not written, so a caller can keep the raw video.
 */

/** Sizes in pixels at 640 px frame width; scaled with the frame. */
export const POINT_TUNING = {
  /** Largest blob side (a guide up to ~1.5 cm across at 40 cm from a webcam). */
  maxSide: 24,
  /** Smallest blob area: single noisy pixels are not worth painting. */
  minArea: 4,
  /** Blobs must fill this share of their bounding box (rejects lines and creases). */
  minFill: 0.3,
  /** Longest/shortest bounding-box side (rejects finger gaps and creases). */
  maxAspect: 3,
  /** The painted area extends this far past the blob, covering its blurred edge. */
  grow: 2,
  /** Width of the ring around the painted area that is checked and copied from. */
  ring: 3,
  /**
   * Share of the ring that must be skin. High for a dark guide, so that dark
   * gaps between fingers (open to the background) and glasses or hair at the
   * edge of the face are left alone. Lower for a yellow anchor, which nothing
   * else on a hand looks like, so one on the outline of a curled fingertip
   * (skin on one side, background on the other) is still removed.
   */
  darkSkinRing: 0.75,
  yellowSkinRing: 0.4,
  /** Largest share of the ring that may itself look like a point (dark or yellow). */
  pointRing: 0.2,
  /** A dark guide is at most this bright relative to the ring around it. */
  darkContrast: 0.55,
} as const;

const DARK = 1,
  YELLOW = 2;

/**
 * DARK for a black guide (dark and not strongly coloured: shadowed skin stays
 * saturated), YELLOW for a fingertip anchor (saturated yellow, clear of skin
 * hues, which stay below 38°), otherwise 0.
 */
export function pointKind(r: number, g: number, b: number): number {
  const max = r > g ? (r > b ? r : b) : g > b ? g : b;
  const min = r < g ? (r < b ? r : b) : g < b ? g : b;
  const delta = max - min;
  if (max <= 90) return delta <= 0.45 * max || max <= 32 ? DARK : 0;
  if (delta < 0.5 * max || max === b) return 0;
  const hue = max === r ? (60 * (g - b)) / delta : 60 * ((b - r) / delta + 2);
  return hue >= 42 && hue <= 75 ? YELLOW : 0;
}

/**
 * Skin, light to dark and under warm or cool light, and a glove repainted to
 * skin (gloveColor.ts). Narrow on purpose: yellow, orange and wood surfaces
 * (hue above ~38° or saturation above ~0.65) are not skin, so a yellow or dark
 * spot on them is not taken for a point.
 */
export function isSkinPixel(r: number, g: number, b: number): boolean {
  if (r < 45 || r < g || r < b) return false;
  const min = g < b ? g : b;
  const delta = r - min;
  if (delta < 0.12 * r || delta > 0.65 * r) return false;
  // Hue from slightly toward magenta (−15°) to orange (38°).
  const hue = (60 * (g - b)) / delta;
  return hue <= 38 && hue >= -15;
}

/** Reusable buffers for point removal. */
export interface PointScratch {
  /** Pixels painted by the last call. */
  painted: number;
  kind: Uint8Array;
  stack: Int32Array;
  members: Int32Array;
  window: Uint8Array;
  temp: Uint8Array;
  colour: Float32Array;
}
export function createPointScratch(): PointScratch {
  return {
    painted: 0,
    kind: new Uint8Array(0),
    stack: new Int32Array(0),
    members: new Int32Array(0),
    window: new Uint8Array(0),
    temp: new Uint8Array(0),
    colour: new Float32Array(0),
  };
}
/** A pixel rectangle [x0, x1) × [y0, y1). */
export interface PointRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Window cell states while checking and painting one blob.
const OUTSIDE = 0,
  BLOB = 1,
  PAINT = 2,
  RING = 3,
  KNOWN = 4,
  PAINTED = 5;

/** Marks OUTSIDE cells within Chebyshev distance k of a cell in 1..`from` as `to`. */
function dilate(
  win: Uint8Array,
  temp: Uint8Array,
  w: number,
  h: number,
  k: number,
  from: number,
  to: number,
) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let xx = Math.max(0, x - k); xx <= Math.min(w - 1, x + k); xx++) {
        const s = win[y * w + xx];
        if (s >= 1 && s <= from) {
          hit = 1;
          break;
        }
      }
      temp[y * w + x] = hit;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (win[i] !== OUTSIDE) continue;
      for (let yy = Math.max(0, y - k); yy <= Math.min(h - 1, y + k); yy++)
        if (temp[yy * w + x]) {
          win[i] = to;
          break;
        }
    }
}

/**
 * Finds black guides and yellow anchors in `src` (RGBA) and writes a copy with
 * them painted over to `dst` (which may be `src`). When nothing is found, `dst`
 * is left untouched and 0 is returned; otherwise the number of points removed.
 */
export function removeHandPoints(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  width: number,
  height: number,
  scratch: PointScratch = createPointScratch(),
  options: {
    /** Only search here (default: the whole image). */
    region?: PointRegion;
    /** Width of the camera frame when `src` is a crop of it (sizes scale with it). */
    frameWidth?: number;
  } = {},
): number {
  const { region, frameWidth = width } = options;
  scratch.painted = 0;
  const pixels = width * height;
  if (!pixels || src.length < pixels * 4 || dst.length < pixels * 4) return 0;
  const x0 = Math.max(0, Math.floor(region?.x0 ?? 0)),
    y0 = Math.max(0, Math.floor(region?.y0 ?? 0)),
    x1 = Math.min(width, Math.ceil(region?.x1 ?? width)),
    y1 = Math.min(height, Math.ceil(region?.y1 ?? height));
  if (x1 <= x0 || y1 <= y0) return 0;
  const T = POINT_TUNING;
  const scale = frameWidth / 640;
  const maxSide = Math.max(4, Math.round(T.maxSide * scale));
  const minArea = Math.max(2, Math.round(T.minArea * scale * scale));
  const grow = Math.max(1, Math.round(T.grow * scale));
  const pad = grow + Math.max(2, Math.round(T.ring * scale));
  const side = maxSide + 2 * pad;
  if (scratch.kind.length !== pixels) {
    scratch.kind = new Uint8Array(pixels);
    scratch.stack = new Int32Array(pixels);
    scratch.members = new Int32Array(pixels);
  }
  if (scratch.window.length < side * side) {
    scratch.window = new Uint8Array(side * side);
    scratch.temp = new Uint8Array(side * side);
    scratch.colour = new Float32Array(side * side * 3);
  }
  const { kind, stack, members, window: win, temp, colour } = scratch;

  // 1. Classify the region. Labelling below clears every entry it sets.
  let candidates = 0;
  for (let y = y0; y < y1; y++)
    for (let p = y * width + x0, end = y * width + x1; p < end; p++) {
      const i = p * 4;
      const k = pointKind(src[i], src[i + 1], src[i + 2]);
      kind[p] = k;
      if (k) candidates++;
    }
  if (!candidates) return 0;

  // 2. Label 8-connected blobs of one kind; check each small compact one.
  let copied = src === dst;
  let removed = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0, p = y * width + x0; x < x1; x++, p++) {
      const type = kind[p];
      if (!type) continue;
      kind[p] = 0;
      let used = 0,
        top = 0;
      stack[top++] = p;
      // Raster order reaches each blob at its top row first, so minY is y.
      const minY = y;
      let minX = x,
        maxX = x,
        maxY = y;
      while (top) {
        const q = stack[--top];
        members[used++] = q;
        const qy = (q / width) | 0,
          qx = q - qy * width;
        if (qx < minX) minX = qx;
        else if (qx > maxX) maxX = qx;
        if (qy > maxY) maxY = qy;
        for (let ny = qy > y0 ? qy - 1 : qy; ny <= qy + 1 && ny < y1; ny++)
          for (let nx = qx > x0 ? qx - 1 : qx; nx <= qx + 1 && nx < x1; nx++) {
            const n = ny * width + nx;
            if (kind[n] === type) {
              kind[n] = 0;
              stack[top++] = n;
            }
          }
      }
      const bw = maxX - minX + 1,
        bh = maxY - minY + 1;
      if (
        used < minArea ||
        bw > maxSide ||
        bh > maxSide ||
        used < T.minFill * bw * bh ||
        Math.max(bw, bh) > T.maxAspect * Math.min(bw, bh)
      )
        continue;
      if (paint(type, minX - pad, minY - pad, bw + 2 * pad, bh + 2 * pad, used))
        removed++;
    }
  return removed;

  /** Checks one labelled blob (members[0..area)) and paints it if it is a point. */
  function paint(
    type: number,
    wx: number,
    wy: number,
    w: number,
    h: number,
    area: number,
  ): boolean {
    const image = copied ? dst : src;
    // Quick reject on the window's border before the exact ring below: most
    // dark or yellow spots in a room are not on skin.
    let edge = 0,
      edgeSkin = 0;
    for (let cy = 0; cy < h; cy++) {
      const y = wy + cy;
      if (y < 0 || y >= height) continue;
      const step = cy === 0 || cy === h - 1 ? 1 : w - 1;
      for (let cx = 0; cx < w; cx += step) {
        const x = wx + cx;
        if (x < 0 || x >= width) continue;
        const i = (y * width + x) * 4;
        edge++;
        if (isSkinPixel(image[i], image[i + 1], image[i + 2])) edgeSkin++;
      }
    }
    const minSkin = type === DARK ? T.darkSkinRing : T.yellowSkinRing;
    if (edgeSkin < minSkin * edge) return false;
    win.fill(OUTSIDE, 0, w * h);
    for (let m = 0; m < area; m++) {
      const q = members[m];
      const qy = (q / width) | 0;
      win[(qy - wy) * w + (q - qy * width - wx)] = BLOB;
    }
    dilate(win, temp, w, h, grow, BLOB, PAINT);
    dilate(win, temp, w, h, pad - grow, PAINT, RING);
    // Ring cells become colour sources (KNOWN), except point-like ones.
    let ring = 0,
      skin = 0,
      pointLike = 0,
      known = 0,
      knownValue = 0,
      blobValue = 0,
      sumR = 0,
      sumG = 0,
      sumB = 0;
    for (let cy = 0; cy < h; cy++) {
      const y = wy + cy;
      for (let cx = 0; cx < w; cx++) {
        const c = cy * w + cx;
        const state = win[c];
        if (state !== RING && state !== BLOB) continue;
        const x = wx + cx;
        if (x < 0 || y < 0 || x >= width || y >= height) {
          win[c] = OUTSIDE;
          continue;
        }
        const i = (y * width + x) * 4;
        const r = image[i],
          g = image[i + 1],
          b = image[i + 2];
        const value = r > g ? (r > b ? r : b) : g > b ? g : b;
        if (state === BLOB) {
          blobValue += value;
          continue;
        }
        ring++;
        if (pointKind(r, g, b)) {
          pointLike++;
          win[c] = OUTSIDE;
          continue;
        }
        if (isSkinPixel(r, g, b)) skin++;
        known++;
        knownValue += value;
        sumR += r;
        sumG += g;
        sumB += b;
        win[c] = KNOWN;
        colour[c * 3] = r;
        colour[c * 3 + 1] = g;
        colour[c * 3 + 2] = b;
      }
    }
    if (
      !known ||
      skin < minSkin * ring ||
      pointLike > T.pointRing * ring ||
      (type === DARK &&
        blobValue / area > T.darkContrast * (knownValue / known))
    )
      return false;
    if (!copied) {
      dst.set(src.subarray(0, pixels * 4));
      copied = true;
    }
    // Onion-peel fill: each pass paints the cells next to known colour with the
    // average of their known neighbours, so shading carries in from the edge.
    for (let c = 0; c < w * h; c++) if (win[c] === BLOB) win[c] = PAINT;
    for (let pass = 0, fresh = 1; fresh && pass < w + h; pass++) {
      fresh = 0;
      for (let cy = 0; cy < h; cy++)
        for (let cx = 0; cx < w; cx++) {
          const c = cy * w + cx;
          temp[c] = 0;
          if (win[c] !== PAINT) continue;
          let n = 0,
            r = 0,
            g = 0,
            b = 0;
          for (
            let yy = Math.max(0, cy - 1);
            yy <= Math.min(h - 1, cy + 1);
            yy++
          )
            for (
              let xx = Math.max(0, cx - 1);
              xx <= Math.min(w - 1, cx + 1);
              xx++
            ) {
              const k = yy * w + xx;
              if (win[k] !== KNOWN && win[k] !== PAINTED) continue;
              r += colour[k * 3];
              g += colour[k * 3 + 1];
              b += colour[k * 3 + 2];
              n++;
            }
          if (!n) continue;
          colour[c * 3] = r / n;
          colour[c * 3 + 1] = g / n;
          colour[c * 3 + 2] = b / n;
          temp[c] = 1;
          fresh++;
        }
      for (let c = 0; c < w * h; c++) if (temp[c]) win[c] = PAINTED;
    }
    for (let cy = 0; cy < h; cy++) {
      const y = wy + cy;
      for (let cx = 0; cx < w; cx++) {
        const c = cy * w + cx;
        if (win[c] === PAINT) {
          // Cut off from the ring (rare): the ring's mean colour.
          colour[c * 3] = sumR / known;
          colour[c * 3 + 1] = sumG / known;
          colour[c * 3 + 2] = sumB / known;
        } else if (win[c] !== PAINTED) continue;
        const x = wx + cx;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const i = (y * width + x) * 4;
        dst[i] = colour[c * 3];
        dst[i + 1] = colour[c * 3 + 1];
        dst[i + 2] = colour[c * 3 + 2];
        scratch.painted++;
      }
    }
    return true;
  }
}
