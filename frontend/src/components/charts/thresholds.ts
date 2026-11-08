// The smallest differences a headline may call a change. Below them the copy says "about the same".
// Values are compared as they are shown (whole % points, whole mA), never as raw floats.

/**
 * Active range and effort, in whole percentage points. Camera estimates move a few points
 * between sessions on their own, so smaller changes are not called better or worse.
 */
export const RANGE_MARGIN_POINTS = 5;

/** Resistance and fast − slow, in whole mA of extra motor current. */
export const RESISTANCE_MARGIN_MA = 5;

/** Whole percentage points, as `pct` shows a 0..1 value. */
export const toPoints = (fraction: number) => Math.round(fraction * 100);

/** 1 when `a` is meaningfully above `b`, −1 when below, 0 when within `margin`. Both already rounded. */
export function meaningful(a: number, b: number, margin: number): -1 | 0 | 1 {
  const d = a - b;
  return d >= margin ? 1 : d <= -margin ? -1 : 0;
}

/** Compare two 0..1 fractions in whole percentage points. */
export const compareRange = (a: number, b: number) =>
  meaningful(toPoints(a), toPoints(b), RANGE_MARGIN_POINTS);

/** Compare two mA values in whole mA. */
export const compareResistance = (a: number, b: number) =>
  meaningful(Math.round(a), Math.round(b), RESISTANCE_MARGIN_MA);
