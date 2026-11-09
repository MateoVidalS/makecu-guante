import type { Landmark } from './flex';
import {
  createRecolorScratch,
  gloveCoverage,
  recolorGlove,
  type GloveColor,
} from './gloveColor';
import {
  createDeviceScratch,
  deviceCoverage,
  inpaintDevice,
  type DeviceVariant,
} from './deviceInpaint';
import { isSkinPixel } from './deviceInpaintPoints';

/**
 * Device profiles: what the patient wears on the hand, and how each frame is
 * prepared for MediaPipe's hand landmarker (trained on bare skin) because of it.
 * Adding a device = adding one entry to DEVICE_PROFILES.
 *
 * A profile's preprocessing step rewrites a copy of the frame before inference
 * (the preview video is never changed). Its coverage helper tells, from the
 * original pixels under a detected hand, how much of that hand looks like the
 * device; automatic mode uses it to find out what the tracked hand wears.
 */

/** Reusable buffers for preprocessing steps, one entry per kind: frames allocate nothing. */
export class StepScratch {
  private readonly entries = new Map<string, unknown>();
  get<T>(key: string, create: () => T): T {
    let entry = this.entries.get(key) as T | undefined;
    if (entry === undefined) {
      entry = create();
      this.entries.set(key, entry);
    }
    return entry;
  }
}
/** A pixel rectangle [x0, x1) × [y0, y1). */
export interface PixelRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/**
 * Copies RGBA `src` into `dst` (same size), rewriting the device's pixels so
 * MediaPipe sees a bare hand. Returns the fraction of pixels changed. Pure
 * apart from `scratch`. `region`, when given, is where the hand was last
 * tracked (handRegion); a step may limit its work to it.
 */
export type PreprocessStep = (
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  width: number,
  height: number,
  scratch: StepScratch,
  region?: PixelRegion | null,
) => number;
/** Share (0–1) of a detected hand that looks like the device, read from the original frame. */
export type CoverageStep = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  landmarks: readonly Landmark[],
) => number;

interface ProfileSpec {
  id: string;
  /** User-facing name, sentence case. */
  label: string;
  /** One user-facing line describing the device. */
  description: string;
  kind: 'bare' | 'glove' | 'device';
  /** Applied before MediaPipe; null = the raw video (no pixels read). */
  preprocess: PreprocessStep | null;
  coverage: CoverageStep | null;
  /** Automatic mode tries this profile, in table order, while the hand is lost. */
  search: boolean;
  /**
   * Automatic mode switches a tracked hand to this profile when its coverage
   * reaches this value; null = never.
   */
  suggestCoverage: number | null;
  /**
   * Automatic mode leaves this profile for the raw video when a tracked hand's
   * coverage stays below this value for MISMATCH_FRAMES frames.
   */
  minCoverage: number;
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
 * Share of the hand's skeleton points (landmarks and bone midpoints, 3×3
 * average) whose colour passes `test`, as gloveCoverage and deviceCoverage do.
 */
export function skeletonShare(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  landmarks: readonly Landmark[],
  test: (r: number, g: number, b: number) => boolean,
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
    if (test(r / n, g / n, b / n)) matched++;
  }
  return inside ? matched / inside : 0;
}

/** Coverage at which a tracked hand is taken to wear a glove. */
export const SUGGEST_COVERAGE = 0.6;
/** Below this coverage, the tracked hand is not wearing the active glove. */
export const MIN_COVERAGE = 0.3;
/**
 * Strap device coverage: the share of skeleton points that are strap, guide or
 * cable coloured (deviceCoverage 'straps'), counted only on a hand that is
 * mostly skin (isSkinPixel share ≥ STRAP_MIN_SKIN), so a glove never looks
 * like straps (the dark rule includes every black glove pixel). On real
 * recordings (IMAGE detections, raw and inpainted): the device hand had skin
 * 0.62–1.0 and strap coverage 0.26 median (≥ 0.2 in 71/108); 192 bare hands
 * (bystanders, the free hand) skin ≥ 0.86 and strap coverage ≤ 0.19; 114
 * violet glove hands skin ≤ 0.10; rendered black, grey, sky blue and magenta
 * gloves skin 0. Leaving below 0.1 follows deviceInpaint's evidence (device
 * hand 10th percentile 0.07–0.24, bare ≈ 0).
 */
export const STRAP_MIN_SKIN = 0.4;
export const STRAP_SUGGEST_COVERAGE = 0.2;
export const STRAP_MIN_COVERAGE = 0.1;

const glove = (color: Exclude<GloveColor, 'none'>) => ({
  // The whole frame: the repaint shades by the glove's mean brightness in it.
  preprocess: ((src, dst, width, height, scratch) =>
    recolorGlove(
      src,
      dst,
      width,
      height,
      color,
      scratch.get('recolor', createRecolorScratch),
    )) satisfies PreprocessStep,
  coverage: ((pixels, width, height, landmarks) =>
    gloveCoverage(
      pixels,
      width,
      height,
      landmarks,
      color,
    )) satisfies CoverageStep,
});
/** deviceInpaint.ts: paints the device over with the skin around it. */
const inpaint =
  (variant: DeviceVariant): PreprocessStep =>
  (src, dst, width, height, scratch, region) =>
    inpaintDevice(
      src,
      dst,
      width,
      height,
      variant,
      scratch.get('device', createDeviceScratch),
      region ?? undefined,
    );

/**
 * Most specific first. Automatic mode searches in this order and suggests the
 * first profile whose coverage is reached: a lavender glove also passes the
 * broader sky blue rule, so violet comes before sky blue (searching sky blue
 * first would lock on while repainting navy clothing too).
 */
export const DEVICE_PROFILES = [
  {
    id: 'bare-hand',
    label: 'Bare hand',
    description: 'Nothing on the hand. Uses the camera image as it is.',
    kind: 'bare',
    preprocess: null,
    coverage: null,
    search: true,
    suggestCoverage: null,
    minCoverage: 0,
  },
  {
    id: 'violet-glove',
    label: 'Violet glove',
    description: 'A lavender or violet glove, such as a nitrile glove.',
    kind: 'glove',
    ...glove('violet'),
    search: true,
    suggestCoverage: SUGGEST_COVERAGE,
    minCoverage: MIN_COVERAGE,
  },
  {
    id: 'sky-blue-glove',
    label: 'Sky blue glove',
    description: 'A light blue glove.',
    kind: 'glove',
    ...glove('sky-blue'),
    search: true,
    suggestCoverage: SUGGEST_COVERAGE,
    minCoverage: MIN_COVERAGE,
  },
  {
    id: 'magenta-glove',
    label: 'Magenta glove',
    description: 'A pink or magenta glove.',
    kind: 'glove',
    ...glove('magenta'),
    search: true,
    suggestCoverage: SUGGEST_COVERAGE,
    minCoverage: MIN_COVERAGE,
  },
  {
    id: 'black-glove',
    label: 'Black glove',
    description: 'A black or dark grey glove.',
    kind: 'glove',
    ...glove('black'),
    search: true,
    // A bare hand in dim light looks dark: only reached by searching a lost hand.
    suggestCoverage: null,
    minCoverage: MIN_COVERAGE,
  },
  {
    id: 'strap-device',
    label: 'Strap device',
    description:
      'Black straps around the finger segments, with thread guides and cables.',
    kind: 'device',
    // Only in this profile: it also fills glasses and narrow dark gaps elsewhere.
    preprocess: inpaint('straps'),
    coverage: (pixels, width, height, landmarks) =>
      skeletonShare(pixels, width, height, landmarks, isSkinPixel) >=
      STRAP_MIN_SKIN
        ? deviceCoverage(pixels, width, height, landmarks, 'straps')
        : 0,
    // Safety review (round 1): in dim light a bare hand passes both the skin and
    // the strap colour rules, and the strap fill then under-reads a near-fist by
    // up to 0.57-0.74. Until a contrast-relative rule is verified, Automatic never
    // enters this profile: choose it explicitly (it also finds the hand about
    // twice as often as Automatic did).
    search: false,
    suggestCoverage: null,
    minCoverage: STRAP_MIN_COVERAGE,
  },
  {
    id: 'dot-points',
    label: 'Dot points',
    description:
      'Small black points on the backs of the fingers, yellow fingertip anchors.',
    kind: 'device',
    preprocess: inpaint('points'),
    // The points are too small to cover skeleton points, so Automatic cannot
    // recognise them; run on every hand they hurt the strap device. Choose it.
    coverage: null,
    search: false,
    suggestCoverage: null,
    minCoverage: 0,
  },
] as const satisfies readonly ProfileSpec[];

export type DeviceProfileId = (typeof DEVICE_PROFILES)[number]['id'];
export type DeviceProfile = ProfileSpec & { id: DeviceProfileId };
export type DeviceSetting = 'auto' | DeviceProfileId;

/** The profile that reads the camera image as it is. */
export const RAW_PROFILE: DeviceProfileId = 'bare-hand';
export const DEVICE_SETTINGS: readonly DeviceSetting[] = [
  'auto',
  ...DEVICE_PROFILES.map((p) => p.id),
];
export const AUTOMATIC_LABEL = 'Automatic';
export const AUTOMATIC_DESCRIPTION =
  'Finds a bare hand or a violet, sky blue, magenta or black glove. For the strap device or dot points, choose them.';

const BY_ID = new Map<DeviceProfileId, DeviceProfile>(
  DEVICE_PROFILES.map((p) => [p.id, p]),
);
export function deviceProfile(id: DeviceProfileId): DeviceProfile {
  return BY_ID.get(id)!;
}
export function isDeviceSetting(value: unknown): value is DeviceSetting {
  return DEVICE_SETTINGS.includes(value as DeviceSetting);
}
export function deviceSettingLabel(setting: DeviceSetting): string {
  return setting === 'auto' ? AUTOMATIC_LABEL : deviceProfile(setting).label;
}

const BACKGROUND_TIP = 'Use a background that is not the glove color.';
/**
 * Setup hint for a setting. `tracking` is the profile in use while Automatic
 * sees the hand (null while it does not).
 */
export function deviceSettingHint(
  setting: DeviceSetting,
  tracking: DeviceProfileId | null = null,
): string {
  if (setting === 'auto')
    return tracking
      ? `Now tracking: ${deviceProfile(tracking).label.toLowerCase()}.`
      : `${AUTOMATIC_DESCRIPTION} ${BACKGROUND_TIP}`;
  const profile = deviceProfile(setting);
  return [profile.description, profile.kind === 'glove' && BACKGROUND_TIP]
    .filter(Boolean)
    .join(' ');
}

/** Start searching other profiles after the hand has been missing this long. */
export const LOST_MS = 250;
/** Consecutive low-coverage frames before automatic mode returns to the raw image. */
export const MISMATCH_FRAMES = 5;
export const SEARCH_ORDER: readonly DeviceProfileId[] = DEVICE_PROFILES.filter(
  (p) => p.search,
).map((p) => p.id);
const SUGGESTED: readonly DeviceProfile[] = DEVICE_PROFILES.filter(
  (p) => p.coverage && p.suggestCoverage !== null,
);

/** The most specific profile the tracked hand wears (by coverage), or null for none. */
export function suggestDeviceProfile(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  landmarks: readonly Landmark[],
): DeviceProfileId | null {
  for (const profile of SUGGESTED)
    if (
      profile.coverage!(pixels, width, height, landmarks) >=
      profile.suggestCoverage!
    )
      return profile.id;
  return null;
}

/** Margin around the tracked hand's box, as a share of its larger side. */
export const REGION_MARGIN = 0.3;
/**
 * The tracked hand's box (normalised landmarks) widened by REGION_MARGIN of its
 * larger side, in pixels and clamped to the frame; null if it is unusable.
 */
export function handRegion(
  landmarks: readonly Landmark[] | null | undefined,
  width: number,
  height: number,
): PixelRegion | null {
  if (!landmarks?.length) return null;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of landmarks) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const margin =
    REGION_MARGIN * Math.max((x1 - x0) * width, (y1 - y0) * height);
  const region = {
    x0: Math.max(0, Math.floor(x0 * width - margin)),
    y0: Math.max(0, Math.floor(y0 * height - margin)),
    x1: Math.min(width, Math.ceil(x1 * width + margin)),
    y1: Math.min(height, Math.ceil(y1 * height + margin)),
  };
  return region.x1 > region.x0 && region.y1 > region.y0 ? region : null;
}

/**
 * Chooses the profile applied to each frame.
 * - A fixed setting always uses that profile (`bare-hand` is the raw video).
 * - `auto` keeps the current profile while the hand is tracked. After the hand
 *   has been lost for LOST_MS it tries the next profile in SEARCH_ORDER on every
 *   frame until one finds the hand. While tracking, it switches to the most
 *   specific profile the hand actually wears (suggestDeviceProfile), so a
 *   lavender glove found as sky blue, or tracked on the raw image, moves to
 *   violet. If the hand found while preprocessing turns out not to wear that
 *   device (coverage under the profile's minCoverage), it goes back to the raw image.
 */
export class DeviceProfileSelector {
  private setting: DeviceSetting;
  private profile: DeviceProfileId;
  private lostSince: number | null = null;
  private mismatches = 0;
  constructor(setting: DeviceSetting = 'auto') {
    this.setting = setting;
    this.profile = setting === 'auto' ? RAW_PROFILE : setting;
  }
  get mode(): DeviceSetting {
    return this.setting;
  }
  get current(): DeviceProfileId {
    return this.profile;
  }
  configure(setting: DeviceSetting) {
    if (setting === this.setting) return;
    this.setting = setting;
    this.profile = setting === 'auto' ? RAW_PROFILE : setting;
    this.reset();
  }
  /** Clears loss tracking; automatic mode keeps the last profile that worked. */
  reset() {
    this.lostSince = null;
    this.mismatches = 0;
  }
  /**
   * Call after every inference. `coverage` is the active profile's coverage for
   * a preprocessed frame with a detected hand, otherwise null. `suggestion` is
   * suggestDeviceProfile() when the frame's pixels were read, otherwise undefined.
   */
  update(
    t: number,
    detected: boolean,
    coverage: number | null = null,
    suggestion?: DeviceProfileId | null,
  ) {
    if (this.setting !== 'auto') return;
    if (detected) {
      this.lostSince = null;
      if (suggestion && suggestion !== this.profile) {
        this.profile = suggestion;
        this.mismatches = 0;
        return;
      }
      if (
        this.profile !== RAW_PROFILE &&
        coverage !== null &&
        coverage < deviceProfile(this.profile).minCoverage
      ) {
        if (++this.mismatches >= MISMATCH_FRAMES) {
          this.profile = RAW_PROFILE;
          this.mismatches = 0;
        }
      } else this.mismatches = 0;
      return;
    }
    this.mismatches = 0;
    this.lostSince ??= t;
    if (t - this.lostSince >= LOST_MS) {
      const next = SEARCH_ORDER.indexOf(this.profile) + 1;
      this.profile = SEARCH_ORDER[next % SEARCH_ORDER.length];
    }
  }
}

const STORAGE_KEY = 'rehab-hub.camera.device-profile';
/** Before device profiles: the glove colour setting. Read once, never written. */
const LEGACY_KEY = 'rehab-hub.camera.glove-color';
const LEGACY_SETTINGS = new Map<string | null, DeviceSetting>([
  ['auto', 'auto'],
  ['none', 'bare-hand'],
  ['violet', 'violet-glove'],
  ['sky-blue', 'sky-blue-glove'],
  ['magenta', 'magenta-glove'],
  ['black', 'black-glove'],
]);
export function savedDeviceSetting(): DeviceSetting {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (isDeviceSetting(value)) return value;
    return LEGACY_SETTINGS.get(localStorage.getItem(LEGACY_KEY)) ?? 'auto';
  } catch {
    return 'auto';
  }
}
export function saveDeviceSetting(setting: DeviceSetting) {
  try {
    localStorage.setItem(STORAGE_KEY, setting);
  } catch {
    /* Private browsing may disallow storage. */
  }
}
