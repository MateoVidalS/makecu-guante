import { describe, expect, it } from 'vitest';
import type { Landmark } from './flex';
import {
  createDeviceScratch,
  deviceCoverage,
  inpaintDevice,
  isDevicePixelOf,
} from './deviceInpaint';

type RGB = readonly [number, number, number];
const SKIN: RGB = [217, 160, 124];
const WALL: RGB = [201, 195, 184];
const BLACK: RGB = [20, 20, 22];
const YELLOW: RGB = [250, 215, 20];
const ORANGE: RGB = [240, 110, 20];

/** An RGBA image filled by `paint(x, y)`. */
function image(
  width: number,
  height: number,
  paint: (x: number, y: number) => RGB,
) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0, i = 0; y < height; y++)
    for (let x = 0; x < width; x++, i += 4) {
      const [r, g, b] = paint(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  return data;
}
const at = (data: Uint8ClampedArray, width: number, x: number, y: number) => {
  const i = (Math.round(y) * width + Math.round(x)) * 4;
  return [data[i], data[i + 1], data[i + 2]];
};
/** Index of the first differing byte, or -1 (fast on whole frames). */
const firstDifference = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
  if (a.length !== b.length) return 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
};
const isSkinLike = ([r, g, b]: number[]) =>
  r > 150 && r > g + 30 && g > b && Math.abs(r - SKIN[0]) < 40;
const disc = (x: number, y: number, cx: number, cy: number, r: number) =>
  (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

describe('inpaintDevice points', () => {
  const W = 640,
    H = 480;
  // A skin patch on a wall, with two black guides and a yellow anchor inside.
  const palm = (x: number, y: number) =>
    x >= 200 && x < 440 && y >= 150 && y < 400;
  const dotted = image(W, H, (x, y) =>
    !palm(x, y)
      ? WALL
      : disc(x, y, 260, 250, 3)
        ? BLACK
        : disc(x, y, 380, 250, 3)
          ? BLACK
          : disc(x, y, 320, 330, 3)
            ? YELLOW
            : SKIN,
  );
  it('paints guides and anchors on skin with the skin around them', () => {
    const dst = new Uint8ClampedArray(dotted.length);
    const share = inpaintDevice(dotted, dst, W, H, 'points');
    expect(share).toBeGreaterThan(0);
    for (const [x, y] of [
      [260, 250],
      [380, 250],
      [320, 330],
    ])
      expect(isSkinLike(at(dst, W, x, y))).toBe(true);
    // Far from the points nothing changes.
    expect(at(dst, W, 210, 160)).toEqual([...SKIN]);
    expect(at(dst, W, 5, 5)).toEqual([...WALL]);
  });
  it('changes nothing on a hand without points and works in place', () => {
    const bare = image(W, H, (x, y) => (palm(x, y) ? SKIN : WALL));
    const dst = new Uint8ClampedArray(bare.length).fill(7);
    expect(inpaintDevice(bare, dst, W, H, 'points')).toBe(0);
    expect(firstDifference(dst, bare)).toBe(-1);
    const copy = dotted.slice();
    expect(inpaintDevice(copy, copy, W, H, 'points')).toBeGreaterThan(0);
    expect(isSkinLike(at(copy, W, 260, 250))).toBe(true);
  });
  it('leaves dark gaps between fingers, creases and dark backgrounds alone', () => {
    // Fingers over a black sweater: the gaps between them are open to the sweater,
    // a thin dark crease crosses one finger, and a dark spot sits on the sweater.
    const finger = (x: number) =>
      [20, 50, 80, 110].some((f) => x >= f && x < f + 22);
    const scene = image(W, H, (x, y) => {
      if (y >= 30 && y < 32 && x >= 52 && x < 70) return [90, 60, 45]; // Crease.
      if (y < 100 && finger(x)) return SKIN;
      if (y >= 100) return SKIN; // Palm.
      return BLACK;
    });
    const dst = new Uint8ClampedArray(scene.length);
    expect(inpaintDevice(scene, dst, W, H, 'points')).toBe(0);
    expect(firstDifference(dst, scene)).toBe(-1);
  });
  it('only searches the given region', () => {
    const dst = new Uint8ClampedArray(dotted.length);
    inpaintDevice(dotted, dst, W, H, 'points', createDeviceScratch(), {
      x0: 200,
      y0: 150,
      x1: 320,
      y1: 300,
    });
    expect(isSkinLike(at(dst, W, 260, 250))).toBe(true);
    expect(at(dst, W, 380, 250)).toEqual([...BLACK]);
  });
});

describe('inpaintDevice straps', () => {
  // Upright fingers (skin) over a black sweater, each crossed by a 14 px black
  // strap carrying a guide, at 640 px geometry scaled by `s`. The gaps between
  // the fingers (32 px) are wider than a strap.
  const FINGERS = [140, 212, 284, 356];
  function hand(width: number, height: number, guide: RGB = YELLOW) {
    const s = width / 640;
    return image(width, height, (x, y) => {
      const f = FINGERS.find((f0) => x >= f0 * s && x < (f0 + 40) * s);
      if (y >= 340 * s) return SKIN; // Palm.
      if (f === undefined) return BLACK; // Sweater.
      if (y >= 200 * s && y < 214 * s)
        return x >= (f + 14) * s && x < (f + 26) * s && y < 208 * s
          ? guide
          : BLACK;
      return SKIN;
    });
  }
  for (const [width, height] of [
    [640, 480], // Processed at half resolution.
    [320, 240],
  ])
    it(`fills straps across fingers but not the gaps between them (${width}×${height})`, () => {
      const s = width / 640;
      const src = hand(width, height);
      const dst = new Uint8ClampedArray(src.length);
      const share = inpaintDevice(src, dst, width, height, 'straps');
      expect(share).toBeGreaterThan(0.005);
      for (const f of FINGERS) {
        // The strap and its guide now look like skin.
        expect(isSkinLike(at(dst, width, (f + 5) * s, 207 * s))).toBe(true);
        expect(isSkinLike(at(dst, width, (f + 20) * s, 204 * s))).toBe(true);
        // The sweater between the fingers stays dark, at strap height too.
        expect(at(dst, width, (f + 56) * s, 100 * s)).toEqual([...BLACK]);
        expect(at(dst, width, (f + 56) * s, 207 * s)[0]).toBeLessThan(60);
        // Skin away from the straps is untouched.
        expect(at(dst, width, (f + 20) * s, 80 * s)).toEqual([...SKIN]);
      }
    });
  it('fills orange guides too, and leaves a frame without skin unchanged', () => {
    const src = hand(320, 240, ORANGE);
    const dst = new Uint8ClampedArray(src.length);
    inpaintDevice(src, dst, 320, 240, 'straps');
    expect(isSkinLike(at(dst, 320, 80, 102))).toBe(true);
    const dark = image(320, 240, (x) => (x < 160 ? BLACK : WALL));
    const out = new Uint8ClampedArray(dark.length);
    expect(inpaintDevice(dark, out, 320, 240, 'straps')).toBe(0);
    expect(firstDifference(out, dark)).toBe(-1);
  });
  it('does not fill dark areas wider than a strap between skin', () => {
    // Two skin blocks 40 px apart at 320 px width (80 px at 640).
    const src = image(320, 240, (x) => (x < 140 || x >= 180 ? SKIN : BLACK));
    const dst = new Uint8ClampedArray(src.length);
    inpaintDevice(src, dst, 320, 240, 'straps');
    expect(at(dst, 320, 160, 120)).toEqual([...BLACK]);
  });
  it('only changes the given region', () => {
    const src = hand(320, 240);
    const dst = new Uint8ClampedArray(src.length);
    inpaintDevice(src, dst, 320, 240, 'straps', createDeviceScratch(), {
      x0: 0,
      y0: 0,
      x1: 100,
      y1: 240,
    });
    expect(isSkinLike(at(dst, 320, 72, 103))).toBe(true);
    expect(at(dst, 320, 180, 103)).toEqual([...BLACK]);
  });
});

describe('deviceCoverage', () => {
  // A straight upright hand skeleton in normalized image coordinates.
  const landmarks: Landmark[] = Array.from({ length: 21 }, (_, i) => {
    if (i === 0) return [0.5, 0.9, 0];
    const finger = Math.floor((i - 1) / 4),
      joint = (i - 1) % 4;
    return [0.3 + finger * 0.1, 0.7 - joint * 0.12, 0];
  });
  it('is high on straps, about 0 on bare skin', () => {
    const W = 100,
      H = 100;
    const bare = image(W, H, () => SKIN);
    expect(deviceCoverage(bare, W, H, landmarks, 'straps')).toBe(0);
    // Every other band of rows is a strap.
    const strapped = image(W, H, (_, y) =>
      Math.floor(y / 6) % 2 ? BLACK : SKIN,
    );
    expect(deviceCoverage(strapped, W, H, landmarks, 'straps')).toBeGreaterThan(
      0.3,
    );
    expect(deviceCoverage(bare, W, H, landmarks.slice(1), 'straps')).toBe(0);
  });
  it('matches the variant colour rules', () => {
    expect(isDevicePixelOf('straps', ...ORANGE)).toBe(true);
    expect(isDevicePixelOf('points', ...ORANGE)).toBe(false);
    expect(isDevicePixelOf('points', ...YELLOW)).toBe(true);
    expect(isDevicePixelOf('straps', ...SKIN)).toBe(false);
    expect(isDevicePixelOf('points', ...SKIN)).toBe(false);
  });
});
