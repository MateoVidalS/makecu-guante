import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEVICE_PROFILES,
  DEVICE_SETTINGS,
  DeviceProfileSelector,
  LOST_MS,
  MISMATCH_FRAMES,
  RAW_PROFILE,
  SEARCH_ORDER,
  STRAP_MIN_COVERAGE,
  STRAP_MIN_SKIN,
  STRAP_SUGGEST_COVERAGE,
  StepScratch,
  deviceProfile,
  deviceSettingHint,
  deviceSettingLabel,
  handRegion,
  isDeviceSetting,
  skeletonShare,
  savedDeviceSetting,
  saveDeviceSetting,
  suggestDeviceProfile,
  type DeviceProfileId,
} from './deviceProfiles';
import {
  createRecolorScratch,
  gloveCoverage,
  isGlovePixel,
  recolorGlove,
} from './gloveColor';
import {
  createDeviceScratch,
  deviceCoverage,
  inpaintDevice,
} from './deviceInpaint';
import type { Landmark } from './flex';

type RGB = [number, number, number];
const image = (pixels: RGB[]) =>
  new Uint8ClampedArray(pixels.flatMap(([r, g, b]) => [r, g, b, 255]));
/** A 64×8 frame with every glove colour, skin, a navy shirt and a white wall. */
const width = 64,
  height = 8;
const SWATCHES: RGB[] = [
  [95, 100, 160],
  [30, 35, 90],
  [120, 190, 230],
  [205, 40, 165],
  [12, 10, 14],
  [224, 172, 140],
  [25, 44, 79],
  [235, 235, 235],
];
const frame = image(
  Array.from(
    { length: width * height },
    (_, p): RGB => SWATCHES[Math.floor((p % width) / 8)],
  ),
);
const GLOVES = [
  ['violet-glove', 'violet'],
  ['sky-blue-glove', 'sky-blue'],
  ['magenta-glove', 'magenta'],
  ['black-glove', 'black'],
] as const;

describe('device profile table', () => {
  it('has one entry per device, each with a name and a one-line description', () => {
    const ids = DEVICE_PROFILES.map((p) => p.id);
    expect(ids).toEqual([
      'bare-hand',
      'violet-glove',
      'sky-blue-glove',
      'magenta-glove',
      'black-glove',
      'strap-device',
      'dot-points',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of DEVICE_PROFILES) {
      expect(deviceProfile(p.id)).toBe(p);
      expect(p.label).toMatch(/^[A-Z][a-z ]+$/);
      expect(p.description).toMatch(/^[A-Z][^\n¿¡]{8,80}\.$/);
    }
    expect(DEVICE_SETTINGS).toEqual(['auto', ...ids]);
    expect(deviceSettingLabel('auto')).toBe('Automatic');
    expect(deviceSettingLabel('strap-device')).toBe('Strap device');
    expect(isDeviceSetting('violet-glove')).toBe(true);
    expect(isDeviceSetting('violet')).toBe(false);
    expect(isDeviceSetting(null)).toBe(false);
  });
  it('reads a bare hand from the raw video, with no preprocessing', () => {
    const bare = deviceProfile(RAW_PROFILE);
    expect(RAW_PROFILE).toBe('bare-hand');
    expect(bare.preprocess).toBeNull();
    expect(bare.coverage).toBeNull();
  });
  it('applies the existing glove repaint and coverage, unchanged', () => {
    const landmarks = Array.from({ length: 21 }, (_, i): Landmark => [
      (i % 8) / 8 + 0.06,
      0.5,
      0,
    ]);
    for (const [id, color] of GLOVES) {
      const profile = deviceProfile(id);
      const expected = new Uint8ClampedArray(frame.length);
      const actual = new Uint8ClampedArray(frame.length);
      const fraction = recolorGlove(
        frame,
        expected,
        width,
        height,
        color,
        createRecolorScratch(),
      );
      expect(fraction).toBeGreaterThan(0);
      expect(
        profile.preprocess!(frame, actual, width, height, new StepScratch()),
      ).toBe(fraction);
      expect(actual).toEqual(expected);
      expect(profile.coverage!(frame, width, height, landmarks)).toBe(
        gloveCoverage(frame, width, height, landmarks, color),
      );
      // Always the whole frame: the repaint shades by the glove's mean brightness.
      const inRegion = new Uint8ClampedArray(frame.length);
      profile.preprocess!(frame, inRegion, width, height, new StepScratch(), {
        x0: 0,
        y0: 0,
        x1: 8,
        y1: 8,
      });
      expect(inRegion).toEqual(expected);
    }
  });
  it('shares one set of repaint buffers across gloves, as before', () => {
    const scratch = new StepScratch();
    const dst = new Uint8ClampedArray(frame.length);
    deviceProfile('violet-glove').preprocess!(
      frame,
      dst,
      width,
      height,
      scratch,
    );
    const buffers = scratch.get('recolor', createRecolorScratch);
    deviceProfile('black-glove').preprocess!(
      frame,
      dst,
      width,
      height,
      scratch,
    );
    expect(scratch.get('recolor', createRecolorScratch)).toBe(buffers);
  });
  it('paints each device over with its own inpainting variant only', () => {
    // A 64×48 skin frame with a dark strap across a finger and a small dark dot.
    const w = 64,
      h = 48;
    const skin: RGB = [224, 172, 140];
    const src = image(
      Array.from({ length: w * h }, (_, p): RGB => {
        const x = p % w,
          y = Math.floor(p / w);
        if (y >= 20 && y < 26 && x >= 10 && x < 30) return [20, 20, 22];
        if (y >= 34 && y < 37 && x >= 44 && x < 47) return [25, 22, 24];
        return skin;
      }),
    );
    const region = { x0: 4, y0: 4, x1: 60, y1: 44 };
    for (const [id, variant] of [
      ['strap-device', 'straps'],
      ['dot-points', 'points'],
    ] as const) {
      const profile = deviceProfile(id);
      expect(profile.kind).toBe('device');
      for (const box of [null, region]) {
        const expected = new Uint8ClampedArray(src.length);
        const actual = new Uint8ClampedArray(src.length);
        const fraction = inpaintDevice(
          src,
          expected,
          w,
          h,
          variant,
          createDeviceScratch(),
          box ?? undefined,
        );
        expect(
          profile.preprocess!(src, actual, w, h, new StepScratch(), box),
        ).toBe(fraction);
        expect(actual).toEqual(expected);
      }
    }
    // At webcam size, a 14 px strap across a finger is painted over with skin.
    const big = image(
      Array.from({ length: 640 * 480 }, (_, p): RGB => {
        const x = p % 640,
          y = Math.floor(p / 640);
        return y >= 200 && y < 214 && x >= 100 && x < 300 ? [20, 20, 22] : skin;
      }),
    );
    const dst = new Uint8ClampedArray(big.length);
    expect(
      deviceProfile('strap-device').preprocess!(
        big,
        dst,
        640,
        480,
        new StepScratch(),
      ),
    ).toBeGreaterThan(0);
    expect(dst[(206 * 640 + 200) * 4]).toBeGreaterThan(150);
    const landmarks = Array.from({ length: 21 }, (_, i): Landmark => [
      0.2 + (i % 5) * 0.12,
      0.1 + Math.floor(i / 5) * 0.2,
      0,
    ]);
    expect(deviceProfile('strap-device').coverage!(src, w, h, landmarks)).toBe(
      deviceCoverage(src, w, h, landmarks, 'straps'),
    );
  });
  it('keeps dot points out of Automatic: too small to recognise', () => {
    const dots = deviceProfile('dot-points');
    expect(dots.coverage).toBeNull();
    expect(dots.search).toBe(false);
    expect(dots.suggestCoverage).toBeNull();
  });
  it('searches bare, violet, sky blue, magenta, black as before, then the straps', () => {
    expect(SEARCH_ORDER).toEqual([
      'bare-hand',
      'violet-glove',
      'sky-blue-glove',
      'magenta-glove',
      'black-glove',
      'strap-device',
    ]);
  });
});

describe('suggestDeviceProfile', () => {
  const size = 10;
  const hand: Landmark[] = Array.from({ length: 21 }, (_, i): Landmark => [
    0.1 + (i % 5) * 0.2,
    0.1 + Math.floor(i / 5) * 0.2,
    0,
  ]);
  const filled = (rgb: RGB) =>
    image(Array.from({ length: size * size }, () => rgb));
  it('names the most specific profile the hand wears', () => {
    // Lavender passes both the violet and the broader sky blue rule.
    expect(isGlovePixel('sky-blue', 95, 100, 160)).toBe(true);
    expect(suggestDeviceProfile(filled([95, 100, 160]), size, size, hand)).toBe(
      'violet-glove',
    );
    expect(
      suggestDeviceProfile(filled([120, 190, 230]), size, size, hand),
    ).toBe('sky-blue-glove');
    expect(suggestDeviceProfile(filled([205, 40, 165]), size, size, hand)).toBe(
      'magenta-glove',
    );
  });
  it('suggests nothing for skin or black (never auto-switches into black)', () => {
    expect(
      suggestDeviceProfile(filled([224, 172, 140]), size, size, hand),
    ).toBeNull();
    // A hand dark all over is a black glove, not straps on skin.
    expect(
      suggestDeviceProfile(filled([15, 15, 18]), size, size, hand),
    ).toBeNull();
    expect(deviceProfile('black-glove').suggestCoverage).toBeNull();
  });
  // Rows from the top: `dark` rows of strap black, then `rest`.
  const rows = (dark: number, rest: RGB) =>
    image(
      Array.from({ length: size * size }, (_, p): RGB =>
        Math.floor(p / size) < dark ? [20, 20, 22] : rest,
      ),
    );
  const skin: RGB = [224, 172, 140];
  it('names the strap device when part of a bare hand is strap-coloured', () => {
    const straps = deviceProfile('strap-device').coverage!;
    expect(straps(rows(4, skin), size, size, hand)).toBe(
      deviceCoverage(rows(4, skin), size, size, hand, 'straps'),
    );
    expect(straps(rows(4, skin), size, size, hand)).toBeGreaterThanOrEqual(
      STRAP_SUGGEST_COVERAGE,
    );
    expect(suggestDeviceProfile(rows(4, skin), size, size, hand)).toBe(
      'strap-device',
    );
    // A dark sleeve edge or shadow on a few points is not the device.
    expect(straps(rows(1, skin), size, size, hand)).toBeLessThan(
      STRAP_SUGGEST_COVERAGE,
    );
    expect(suggestDeviceProfile(rows(1, skin), size, size, hand)).toBeNull();
    expect(deviceProfile('strap-device').minCoverage).toBe(STRAP_MIN_COVERAGE);
  });
  it('never takes a glove for the strap device: straps sit on skin', () => {
    const straps = deviceProfile('strap-device').coverage!;
    // A black glove with grey highlights, and a violet glove with dark folds:
    // dark enough for the strap colour rule, but no skin under the skeleton.
    for (const glove of [rows(5, [120, 120, 125]), rows(4, [95, 100, 160])]) {
      expect(
        deviceCoverage(glove, size, size, hand, 'straps'),
      ).toBeGreaterThanOrEqual(STRAP_SUGGEST_COVERAGE);
      expect(skeletonShare(glove, size, size, hand, () => true)).toBe(1);
      expect(straps(glove, size, size, hand)).toBe(0);
      expect(suggestDeviceProfile(glove, size, size, hand)).not.toBe(
        'strap-device',
      );
    }
    expect(STRAP_MIN_SKIN).toBeGreaterThan(0.1); // Real violet gloves: ≤ 0.10.
  });
});

describe('DeviceProfileSelector', () => {
  const lose = (
    selector: DeviceProfileSelector,
    from: number,
    frames: number,
  ) => {
    const seen: DeviceProfileId[] = [];
    for (let i = 0; i < frames; i++) {
      selector.update(from + i * 33, false);
      seen.push(selector.current);
    }
    return seen;
  };
  it('keeps a fixed setting regardless of detection', () => {
    const selector = new DeviceProfileSelector('magenta-glove');
    lose(selector, 0, 30);
    expect(selector.current).toBe('magenta-glove');
    selector.update(1000, true, 0);
    expect(selector.current).toBe('magenta-glove');
    const straps = new DeviceProfileSelector('strap-device');
    lose(straps, 0, 30);
    straps.update(1000, true, 0, 'violet-glove');
    expect(straps.current).toBe('strap-device');
  });
  it('starts on the raw image and keeps it while the hand is tracked', () => {
    const selector = new DeviceProfileSelector();
    for (let t = 0; t < 2000; t += 33) selector.update(t, true);
    expect(selector.current).toBe('bare-hand');
  });
  it('waits before searching, then tries one profile per frame', () => {
    const selector = new DeviceProfileSelector();
    const frames = Math.ceil(LOST_MS / 33);
    expect(lose(selector, 0, frames)).toEqual(Array(frames).fill('bare-hand'));
    expect(lose(selector, frames * 33, 7)).toEqual([
      'violet-glove',
      'sky-blue-glove',
      'magenta-glove',
      'black-glove',
      'strap-device',
      'bare-hand',
      'violet-glove',
    ]);
  });
  it('locks onto the profile that finds the hand', () => {
    const selector = new DeviceProfileSelector();
    lose(selector, 0, 11); // The 9th lost frame (264 ms) starts the search.
    expect(selector.current).toBe('magenta-glove');
    for (let t = 400; t < 3000; t += 33) selector.update(t, true, 0.9);
    expect(selector.current).toBe('magenta-glove');
  });
  it('returns to the raw image when the tracked hand does not wear that device', () => {
    const selector = new DeviceProfileSelector();
    lose(selector, 0, 10);
    expect(selector.current).toBe('sky-blue-glove');
    for (let i = 0; i < MISMATCH_FRAMES - 1; i++)
      selector.update(400 + i * 33, true, 0.05);
    expect(selector.current).toBe('sky-blue-glove');
    selector.update(400, true, 0.9); // One good frame resets the count.
    for (let i = 0; i < MISMATCH_FRAMES - 1; i++)
      selector.update(500 + i * 33, true, 0.05);
    expect(selector.current).toBe('sky-blue-glove');
    selector.update(700, true, 0.05);
    expect(selector.current).toBe('bare-hand');
  });
  it('switches to the profile the tracked hand actually wears', () => {
    const selector = new DeviceProfileSelector();
    selector.update(0, true, null, 'violet-glove'); // Tracked on the raw image.
    expect(selector.current).toBe('violet-glove');
    selector.update(33, true, 0.9, 'violet-glove');
    expect(selector.current).toBe('violet-glove');
    lose(selector, 66, 9); // Search starts at 330 ms: violet → sky blue.
    expect(selector.current).toBe('sky-blue-glove');
    selector.update(400, true, 0.9, 'violet-glove'); // Found as sky blue: refine.
    expect(selector.current).toBe('violet-glove');
  });
  it('ignores suggestions while the hand is lost or the profile is fixed', () => {
    const auto = new DeviceProfileSelector();
    auto.update(0, false, null, 'violet-glove');
    expect(auto.current).toBe('bare-hand');
    const fixed = new DeviceProfileSelector('magenta-glove');
    fixed.update(0, true, 0.9, 'violet-glove');
    expect(fixed.current).toBe('magenta-glove');
  });
  it('restarts the loss timer after a reset or a new setting', () => {
    const selector = new DeviceProfileSelector();
    lose(selector, 0, 7);
    selector.reset();
    expect(lose(selector, 300, 1)).toEqual(['bare-hand']);
    selector.configure('black-glove');
    expect(selector.current).toBe('black-glove');
    selector.configure('auto');
    expect(selector.current).toBe('bare-hand');
    expect(selector.mode).toBe('auto');
  });
  it('restarts the search from bare after a profile outside the search order', () => {
    // E.g. an integrated device profile suggested while tracked, then lost.
    const selector = new DeviceProfileSelector();
    selector.update(0, true, null, 'dot-points');
    expect(selector.current).toBe('dot-points');
    expect(lose(selector, 33, 10).slice(-3)).toEqual([
      'dot-points',
      'bare-hand',
      'violet-glove',
    ]);
  });
});

describe('handRegion', () => {
  const hand = (x0: number, y0: number, x1: number, y1: number): Landmark[] =>
    Array.from({ length: 21 }, (_, i): Landmark =>
      i % 2 ? [x0, y0, 0] : [x1, y1, 0],
    );
  it("widens the hand's box by 0.3 of its larger side, in pixels", () => {
    // 64×48 px box at (192, 144); 0.3 × 64 = 19.2 px on every side.
    expect(handRegion(hand(0.3, 0.3, 0.4, 0.4), 640, 480)).toEqual({
      x0: 172,
      y0: 124,
      x1: 276,
      y1: 212,
    });
  });
  it('clamps to the frame and rejects missing hands', () => {
    expect(handRegion(hand(0, 0.5, 0.2, 1), 640, 480)).toEqual({
      x0: 0,
      y0: 168, // The larger side is the 240 px height: 72 px margin.
      x1: 200,
      y1: 480,
    });
    expect(handRegion(null, 640, 480)).toBeNull();
    expect(handRegion([], 640, 480)).toBeNull();
    expect(handRegion(hand(2, 2, 3, 3), 640, 480)).toBeNull(); // Off frame.
    expect(handRegion(hand(NaN, 0, 0.1, 0.1), 640, 480)).toBeNull();
  });
});

describe('Setup hint', () => {
  it('lists what Automatic finds, then names what it tracks', () => {
    expect(deviceSettingHint('auto')).toBe(
      'Finds a bare hand, the strap device, or a violet, sky blue, magenta or black glove. Use a background that is not the glove color.',
    );
    expect(deviceSettingHint('auto', 'violet-glove')).toBe(
      'Now tracking: violet glove.',
    );
    expect(deviceSettingHint('auto', 'bare-hand')).toBe(
      'Now tracking: bare hand.',
    );
  });
  it('describes a fixed profile, with its background tip or placeholder note', () => {
    expect(deviceSettingHint('bare-hand', 'violet-glove')).toBe(
      'Nothing on the hand. Uses the camera image as it is.',
    );
    expect(deviceSettingHint('sky-blue-glove')).toBe(
      'A light blue glove. Use a background that is not the glove color.',
    );
    expect(deviceSettingHint('strap-device')).toBe(
      'Black straps around the finger segments, with thread guides and cables.',
    );
  });
});

describe('saved device setting', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());
  const NEW = 'rehab-hub.camera.device-profile',
    OLD = 'rehab-hub.camera.glove-color';
  it('defaults to automatic and persists valid settings only', () => {
    expect(savedDeviceSetting()).toBe('auto');
    saveDeviceSetting('strap-device');
    expect(savedDeviceSetting()).toBe('strap-device');
    expect(localStorage.getItem(NEW)).toBe('strap-device');
    localStorage.setItem(NEW, 'purple');
    expect(savedDeviceSetting()).toBe('auto');
  });
  it('keeps every old glove colour setting', () => {
    for (const [old, setting] of [
      ['auto', 'auto'],
      ['none', 'bare-hand'],
      ['violet', 'violet-glove'],
      ['sky-blue', 'sky-blue-glove'],
      ['magenta', 'magenta-glove'],
      ['black', 'black-glove'],
      ['purple', 'auto'],
      ['toString', 'auto'],
    ]) {
      localStorage.clear();
      localStorage.setItem(OLD, old);
      expect(savedDeviceSetting()).toBe(setting);
    }
  });
  it('prefers the new setting and never rewrites the old one', () => {
    localStorage.setItem(OLD, 'black');
    saveDeviceSetting('dot-points');
    expect(savedDeviceSetting()).toBe('dot-points');
    expect(localStorage.getItem(OLD)).toBe('black');
    localStorage.setItem(NEW, 'not-a-profile');
    expect(savedDeviceSetting()).toBe('black-glove');
  });
  it('falls back to automatic when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(savedDeviceSetting()).toBe('auto');
    expect(() => saveDeviceSetting('violet-glove')).not.toThrow();
  });
});
