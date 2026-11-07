import { useId } from 'react';
import type { GloveFinger } from '../../contracts/glove';
import { clamp01, type FingerFill } from './format';

/**
 * A flat hand pictogram (palm facing you, fingers up). Each glove finger fills from the
 * knuckle toward the tip: blue = on your own, orange = the glove helped on top.
 * The full finger outline is the goal. Unscored or unmeasured fingers stay neutral.
 */
interface Shape {
  x: number;
  y: number;
  w: number;
  h: number;
  rotate?: number;
}
// viewBox 0 0 120 150. Fingers are drawn over the palm so every fill is fully visible.
const SHAPES: Record<GloveFinger, Shape> = {
  thumb: { x: 20, y: 72, w: 17, h: 48, rotate: -36 },
  index: { x: 31, y: 18, w: 17, h: 62 },
  middle: { x: 51, y: 8, w: 17, h: 72 },
  ring: { x: 71, y: 16, w: 16, h: 64 },
  pinky: { x: 90, y: 32, w: 14, h: 48 },
};
const PALM = { x: 28, y: 74, w: 78, h: 66 };

export function HandGlyph({
  fills,
  label,
  size = 120,
  mirrored = false,
  className,
}: {
  /** Per glove finger; null = not part of this pose (drawn neutral). */
  fills: Partial<Record<GloveFinger, FingerFill | null>>;
  label: string;
  size?: number;
  mirrored?: boolean;
  className?: string;
}) {
  const id = useId().replace(/:/g, '');
  const height = (size * 150) / 120;
  return (
    <svg
      className={`mx-hand ${className ?? ''}`.trim()}
      viewBox="0 0 120 150"
      width={size}
      height={height}
      role="img"
      aria-label={label}
    >
      <g transform={mirrored ? 'translate(120 0) scale(-1 1)' : undefined}>
        <rect
          x={PALM.x}
          y={PALM.y}
          width={PALM.w}
          height={PALM.h}
          rx={18}
          className="mx-hand__palm"
        />
        {(Object.keys(SHAPES) as (keyof typeof SHAPES)[]).map((key) => {
          const s = SHAPES[key];
          const fill = fills[key];
          const r = s.w / 2;
          const transform = s.rotate
            ? `rotate(${s.rotate} ${s.x + s.w / 2} ${s.y + s.h})`
            : undefined;
          const own = clamp01(fill?.own ?? 0) * s.h;
          const help = clamp01(fill?.help ?? 0) * s.h;
          const scored = fill != null;
          return (
            <g key={key} transform={transform}>
              <clipPath id={`${id}-${key}`}>
                <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={r} />
              </clipPath>
              <rect
                x={s.x}
                y={s.y}
                width={s.w}
                height={s.h}
                rx={r}
                className={scored ? 'mx-hand__goal' : 'mx-hand__idle'}
              />
              {scored && (
                <g clipPath={`url(#${id}-${key})`}>
                  {own > 0 && (
                    <rect
                      x={s.x}
                      y={s.y + s.h - own}
                      width={s.w}
                      height={own}
                      className="mx-fill--own"
                    />
                  )}
                  {help > 0.5 && (
                    <>
                      <rect
                        x={s.x}
                        y={s.y + s.h - own - help}
                        width={s.w}
                        height={help}
                        className="mx-fill--help"
                      />
                      {own > 0 && (
                        <rect
                          x={s.x}
                          y={s.y + s.h - own - 1}
                          width={s.w}
                          height={2}
                          className="mx-gap"
                        />
                      )}
                    </>
                  )}
                </g>
              )}
              {scored && (
                <rect
                  x={s.x}
                  y={s.y}
                  width={s.w}
                  height={s.h}
                  rx={r}
                  className="mx-hand__outline"
                />
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
