/**
 * The memo logo (docs/brand/BRAND.md). Drawn, not typeset: never write "memo" in a font as a logo.
 *
 * - Mark: a solid "m" (you) in front of a taller, faint "m" (the target it reaches for), the product's
 *   ghost-and-solid hand language on a brand tile. Below 24 px the target is dropped so the mark stays crisp.
 * - Wordmark: monoline lowercase "memo", round caps, `currentColor` (it follows the text color).
 *
 * Both SVGs are decorative: the surrounding link or heading carries the accessible name.
 */

// You: the solid m. Target: a taller m behind it, reaching up. A tile-colored halo cuts a gap between them.
const SOLID = 'M12 37V27a6 6 0 0 1 12 0v10M24 27a6 6 0 0 1 12 0v10';
const TARGET = 'M12 33V15.5a6 6 0 0 1 12 0V33M24 15.5a6 6 0 0 1 12 0V33';
const SMALL = 'M12 35V23a6 6 0 0 1 12 0v12M24 23a6 6 0 0 1 12 0v12';

export interface LogoMarkProps {
  /** Rendered px size of the square tile. */
  size?: number;
}

export function LogoMark({ size = 24 }: LogoMarkProps) {
  return (
    <svg
      className="ds-logo-mark"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden
      focusable="false"
    >
      <rect width="48" height="48" rx="11" fill="var(--brand)" />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {size >= 24 ? (
          <>
            <path
              d={TARGET}
              stroke="var(--on-brand)"
              strokeOpacity={0.4}
              strokeWidth={4}
            />
            <path d={SOLID} stroke="var(--brand)" strokeWidth={10} />
            <path d={SOLID} stroke="var(--on-brand)" strokeWidth={4.5} />
          </>
        ) : (
          <path d={SMALL} stroke="var(--on-brand)" strokeWidth={5} />
        )}
      </g>
    </svg>
  );
}

export interface WordmarkProps {
  /** Rendered px height; the width follows (ratio 72:19). */
  height?: number;
}

export function Wordmark({ height = 18 }: WordmarkProps) {
  return (
    <svg
      className="ds-wordmark"
      height={height}
      width={(height * 72) / 19}
      viewBox="0 4 72 19"
      aria-hidden
      focusable="false"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M1.3 20V11a4 4 0 0 1 8 0v9M9.3 11a4 4 0 0 1 8 0v9" />
        <path d="M20.9 13.5H33.9A6.5 6.5 0 1 0 32 18.1" />
        <path d="M37.5 20V11a4 4 0 0 1 8 0v9M45.5 11a4 4 0 0 1 8 0v9" />
        <circle cx="63.6" cy="13.5" r="6.5" />
      </g>
    </svg>
  );
}

/** Mark + wordmark lockup (spacing in ds.css). */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <span className="ds-logo">
      <LogoMark size={size} />
      <Wordmark height={Math.round(size * 0.72)} />
    </span>
  );
}
