// memo brand for video. Colors come straight from the app's tokens (single source of truth):
// frontend/src/styles/tokens.ts. Never hard-code a hex in a scene; import from here.
//
// Rules (docs/brand/BRAND.md, docs/design/DESIGN_SYSTEM.md):
// - ONE brand color: memo blue (c.brand / c.accent). One memo-blue accent per frame.
// - State colors carry ONE meaning, only when showing that state:
//   active = the patient on their own · assist = the glove helped · reached = reached
//   danger = safety only · demo = simulated/demo data · target = the ghost/goal.
//   Never use them for decoration (no green waveforms, no orange emphasis words).
// - Backgrounds: paper (c.bg) by default; slate (c.chrome) for the few dark beats.
//   No gradients, no glows, no lens flares.
// - Type: Atkinson Hyperlegible Next, weights 400 and 600 only, sentence case, no ALL CAPS
//   (not even eyebrows), tabular numbers.
// - Motion: ease = cubic-bezier(.2,0,0,1), no overshoot, no bounce, no shake.
// - "memo" is always lowercase. Use <Lockup/> / <Mark/>, never typeset the logo.
import { Easing } from 'remotion';
import { tokens } from '../../../../frontend/src/styles/tokens';

export const c = tokens.light;
export const cDark = tokens.dark;

export const font = tokens.font;
export const weight = { regular: 400, semibold: 600 } as const;

// Video type scale for a 1920x1080 frame (the app's scale x ~2.1 for viewing on a laptop or projector).
export const type = {
  hero: 120, // one statement per frame ("Try first.")
  display: 96, // kinetic statements
  h1: 72, // scene titles
  h2: 52, // sub-statements
  h3: 40, // callouts, card titles
  body: 34, // supporting text, captions
  small: 26, // labels, badges, lower-third role
  caption: 20, // citations, disclaimers (the smallest size allowed)
} as const;

export const space = { s8: 8, s16: 16, s24: 24, s32: 32, s48: 48, s64: 64, s96: 96, s128: 128 } as const;
export const radius = { sm: 8, input: 12, card: 20, pill: 999 } as const; // app radii x2

// Safe area: keep text inside 96 px horizontal / 72 px vertical margins.
export const safe = { x: 96, y: 72 } as const;

export const ease = Easing.bezier(0.2, 0, 0, 1);

// Motion durations in frames at 30 fps (app: 120/200/400 ms; video gets a little more air).
export const dur = { fast: 6, base: 9, slow: 15, reach: 15, scene: 18 } as const;

export const shadow = '0 16px 48px #10182814, 0 2px 6px #1018280F'; // app's overlay elevation, x2
