import { describe, expect, it } from 'vitest';
import {
  gloveCoverage,
  isGlovePixel,
  isGloveShadowPixel,
  recolorGlove,
} from './gloveColor';
import type { Landmark } from './flex';

type RGB = [number, number, number];
const COLORS = ['violet', 'sky-blue', 'magenta', 'black'] as const;
const matches = (rgb: RGB) => COLORS.filter((c) => isGlovePixel(c, ...rgb));
const image = (pixels: RGB[]) =>
  new Uint8ClampedArray(pixels.flatMap(([r, g, b]) => [r, g, b, 255]));

describe('glove colour classification', () => {
  it('recognises each glove colour under different lighting', () => {
    for (const rgb of [
      [135, 206, 235],
      [100, 170, 220],
      [60, 110, 150],
      [150, 200, 215],
    ] as RGB[])
      expect(matches(rgb)).toEqual(['sky-blue']);
    for (const rgb of [
      [255, 0, 255],
      [205, 40, 165],
      [120, 30, 110],
      [230, 80, 200],
    ] as RGB[])
      expect(matches(rgb)).toEqual(['magenta']);
    for (const rgb of [
      [20, 20, 25],
      [60, 58, 64],
      [8, 4, 2],
    ] as RGB[])
      expect(matches(rgb)).toEqual(['black']);
  });
  it('recognises a lavender glove as violet, but not navy clothing', () => {
    // Measured on a laptop webcam: glove hue 228–244°, navy T-shirt 217–223°.
    for (const rgb of [
      [63, 70, 115],
      [95, 100, 160],
      [180, 150, 230],
    ] as RGB[])
      expect(matches(rgb)).toContain('violet');
    expect(matches([180, 150, 230])).toEqual(['violet']); // Beyond sky blue.
    for (const rgb of [
      [25, 44, 79],
      [20, 40, 95],
      [40, 60, 120],
    ] as RGB[])
      expect(matches(rgb)).not.toContain('violet');
  });
  it('never treats skin, including shadowed or dark skin, as a glove', () => {
    for (const rgb of [
      [224, 172, 140],
      [241, 194, 167],
      [198, 134, 66],
      [141, 85, 36],
      [92, 51, 23],
      [70, 40, 22],
      [200, 120, 120],
    ] as RGB[])
      expect(matches(rgb)).toEqual([]);
  });
  it('ignores white, grey and beige backgrounds', () => {
    for (const rgb of [
      [255, 255, 255],
      [200, 200, 200],
      [128, 128, 128],
      [230, 225, 210],
      [200, 205, 210],
    ] as RGB[])
      expect(matches(rgb)).toEqual([]);
  });
});

describe('recolorGlove', () => {
  it('repaints only glove pixels in a skin tone, keeping shading and alpha', () => {
    const src = image([
      [135, 206, 235],
      [70, 105, 120],
      [250, 250, 250],
      [224, 172, 140],
    ]);
    src[7] = 128; // Alpha of the second pixel.
    const dst = new Uint8ClampedArray(src.length);
    expect(recolorGlove(src, dst, 4, 1, 'sky-blue')).toBe(0.5);
    const [r0, g0, b0] = dst.slice(0, 3);
    const [r1, g1, b1] = dst.slice(4, 7);
    expect(r0 > g0 && g0 > b0).toBe(true); // Warm skin hue, not blue.
    expect(r1 > g1 && g1 > b1).toBe(true);
    expect(r1).toBeLessThan(r0); // The shaded pixel stays darker.
    expect(dst[7]).toBe(128);
    expect([...dst.slice(8)]).toEqual([...src.slice(8)]);
  });
  it("shades relative to this frame's glove brightness, whatever the light", () => {
    const bright = image([
      [120, 190, 230],
      [60, 95, 115],
    ]);
    const dim = image([
      [60, 95, 115],
      [30, 48, 58],
    ]);
    const a = new Uint8ClampedArray(8),
      b = new Uint8ClampedArray(8);
    recolorGlove(bright, a, 2, 1, 'sky-blue');
    recolorGlove(dim, b, 2, 1, 'sky-blue');
    for (let i = 0; i < 8; i++)
      expect(Math.abs(a[i] - b[i])).toBeLessThanOrEqual(2);
  });
  it('copies the frame unchanged when nothing is glove-coloured', () => {
    const src = image([
      [250, 250, 250],
      [224, 172, 140],
    ]);
    const dst = new Uint8ClampedArray(src.length);
    expect(recolorGlove(src, dst, 2, 1, 'black')).toBe(0);
    expect([...dst]).toEqual([...src]);
    expect(recolorGlove(src, dst, 3, 1, 'black')).toBe(0); // Inconsistent size.
  });

  describe('violet shadow filling', () => {
    // 640×20: strong violet glove in columns 0–99, shadowed fold pixels at 104
    // (inside the 8 px fill radius) and at 300 (an isolated navy patch).
    const width = 640,
      height = 20;
    const glove: RGB = [95, 100, 160],
      shadow: RGB = [30, 35, 90],
      wall: RGB = [230, 230, 230];
    const src = image(
      Array.from({ length: width * height }, (_, p): RGB => {
        const x = p % width;
        return x < 100 ? glove : x === 104 || x === 300 ? shadow : wall;
      }),
    );
    const dst = new Uint8ClampedArray(src.length);
    recolorGlove(src, dst, width, height, 'violet');
    const at = (x: number) => [
      ...dst.slice(x * 4 + 10 * width * 4, x * 4 + 10 * width * 4 + 3),
    ];
    it('classifies the shadow as violet shadow but not as confident violet', () => {
      expect(isGlovePixel('violet', ...shadow)).toBe(false);
      expect(isGloveShadowPixel('violet', ...shadow)).toBe(true);
      expect(isGloveShadowPixel('violet', 224, 172, 140)).toBe(false);
      expect(isGloveShadowPixel('sky-blue', ...shadow)).toBe(false);
    });
    it('repaints shadow pixels next to the glove', () => {
      const [r, g, b] = at(104);
      expect(r > g && g > b).toBe(true);
    });
    it('leaves isolated shadow-coloured pixels, such as a navy shirt, alone', () => {
      expect(at(300)).toEqual(shadow);
      expect(at(500)).toEqual(wall);
    });
  });

  describe('a really black glove', () => {
    // 640×40: a fold (base 4) beside a lit area (base 9), with ±3 camera noise.
    const width = 640,
      height = 40;
    const noise = (p: number, c: number) => ((p * 7919 + c * 104729) % 7) - 3;
    const src = new Uint8ClampedArray(width * height * 4);
    for (let p = 0; p < width * height; p++) {
      const base = p % width < width / 2 ? 4 : 9;
      for (let c = 0; c < 3; c++) src[p * 4 + c] = base + noise(p, c);
      src[p * 4 + 3] = 255;
    }
    const dst = new Uint8ClampedArray(src.length);
    recolorGlove(src, dst, width, height, 'black');
    /** Mean and relative spread of the red channel over a column range. */
    const stats = (data: Uint8ClampedArray, from: number, to: number) => {
      const values: number[] = [];
      for (let y = 10; y < 30; y++)
        for (let x = from; x < to; x++) values.push(data[(y * width + x) * 4]);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const sd = Math.sqrt(
        values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length,
      );
      return { mean, spread: sd / mean };
    };
    it('turns it into visible skin with the fold still darker', () => {
      const fold = stats(dst, 100, 200),
        lit = stats(dst, 440, 540);
      expect(fold.mean).toBeGreaterThan(40);
      expect(lit.mean).toBeGreaterThan(fold.mean * 1.5);
      expect(dst[440 * 4]).toBeGreaterThan(dst[441 * 4 + 1]); // Skin: red > green.
    });
    it('smooths the camera noise instead of amplifying it into speckle', () => {
      expect(stats(dst, 440, 540).spread).toBeLessThan(
        stats(src, 440, 540).spread / 4,
      );
    });
    it('treats a glove crushed to pure black as a uniform mid tone', () => {
      const zero = image(Array.from({ length: 4 }, (): RGB => [0, 0, 0]));
      const out = new Uint8ClampedArray(zero.length);
      recolorGlove(zero, out, 2, 2, 'black');
      expect(out[0]).toBeGreaterThan(100);
      expect(Number.isFinite(out[0])).toBe(true);
    });
  });
});

describe('gloveCoverage', () => {
  const width = 20,
    height = 10;
  // Left half sky blue, right half skin.
  const pixels = image(
    Array.from({ length: width * height }, (_, i): RGB =>
      i % width < width / 2 ? [120, 190, 230] : [224, 172, 140],
    ),
  );
  const hand = (x: number): Landmark[] =>
    Array.from({ length: 21 }, (_, i): Landmark => [x, 0.1 + i * 0.04, 0]);
  it('measures how much of the hand is the glove colour', () => {
    expect(gloveCoverage(pixels, width, height, hand(0.2), 'sky-blue')).toBe(1);
    expect(gloveCoverage(pixels, width, height, hand(0.8), 'sky-blue')).toBe(0);
    expect(gloveCoverage(pixels, width, height, hand(0.2), 'magenta')).toBe(0);
  });
  it('ignores out-of-frame points and rejects incomplete hands', () => {
    const partly = hand(0.2).map((p, i): Landmark => (i % 2 ? [5, 5, 0] : p));
    expect(gloveCoverage(pixels, width, height, partly, 'sky-blue')).toBe(1);
    expect(
      gloveCoverage(pixels, width, height, hand(0.2).slice(1), 'sky-blue'),
    ).toBe(0);
  });
});
