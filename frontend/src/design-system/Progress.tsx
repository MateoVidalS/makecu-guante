import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';

/** `caution`: a non-safety heads-up, e.g. the glove stopped for resistance (never red). */
export type ProgressTone =
  'accent' | 'active' | 'assist' | 'reached' | 'neutral' | 'caution';

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Circular progress (PhaseRing base). A calm continuous fill, no ticking numbers in patient views.
 * `value` 0..1; omit it for an indeterminate ring ("Show me your hand"). Put the icon/label in children.
 */
export function ProgressRing({
  value,
  size = 96,
  thickness = 8,
  tone = 'active',
  label,
  children,
  className,
}: {
  value?: number;
  size?: number;
  thickness?: number;
  tone?: ProgressTone;
  /** Accessible name, e.g. "Try now". */
  label: string;
  children?: ReactNode;
  className?: string;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const indeterminate = value === undefined;
  const v = clamp(value ?? 0.25);
  return (
    <div
      className={cx(
        'ds-ring',
        `ds-ring--${tone}`,
        indeterminate && 'ds-ring--indeterminate',
        className,
      )}
      style={{ width: size, height: size } as CSSProperties}
      role="progressbar"
      aria-label={label}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : 100}
      aria-valuenow={indeterminate ? undefined : Math.round(v * 100)}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
      >
        <circle
          className="ds-ring__track"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={thickness}
        />
        <circle
          className="ds-ring__fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={thickness}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {children && <div className="ds-ring__content">{children}</div>}
    </div>
  );
}

/**
 * Horizontal measured value (role="meter"): telemetry, slow/fast bars, readiness.
 * `target` draws a notch; `segments` stacks e.g. on-your-own (active) + glove-helped (assist).
 */
export function Meter({
  value,
  max = 1,
  label,
  valueText,
  tone = 'accent',
  target,
  segments,
  limit,
  size = 'md',
  showLabel = true,
  className,
}: {
  value: number;
  max?: number;
  label: ReactNode;
  /** What a screen reader hears and what is shown on the right, e.g. "55%" or "120 mA". */
  valueText?: string;
  tone?: ProgressTone | 'danger';
  /** Target notch (same units as value). */
  target?: number;
  /** Stacked segments, rendered from the start. Overrides value fill. */
  segments?: { value: number; tone: ProgressTone; label: string }[];
  /** A limit line (e.g. current limit). Crossing it does not make the bar red by itself. */
  limit?: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}) {
  const pct = (n: number) => `${clamp(n / max) * 100}%`;
  let offset = 0;
  return (
    <div className={cx('ds-meter', `ds-meter--${size}`, className)}>
      {showLabel && (
        <div className="ds-meter__head">
          <span className="ds-meter__label">{label}</span>
          {valueText && <span className="ds-meter__value">{valueText}</span>}
        </div>
      )}
      <div
        className="ds-meter__track"
        role="meter"
        aria-label={typeof label === 'string' ? label : undefined}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText}
      >
        {segments ? (
          segments.map((s) => {
            const style = {
              insetInlineStart: pct(offset),
              width: pct(s.value),
            };
            offset += s.value;
            return (
              <span
                key={s.label}
                title={s.label}
                className={cx('ds-meter__fill', `ds-meter__fill--${s.tone}`)}
                style={style}
              />
            );
          })
        ) : (
          <span
            className={cx('ds-meter__fill', `ds-meter__fill--${tone}`)}
            style={{ width: pct(value) }}
          />
        )}
        {target !== undefined && (
          <span
            className="ds-meter__target"
            style={{ insetInlineStart: pct(target) }}
            title="Target"
          />
        )}
        {limit !== undefined && (
          <span
            className="ds-meter__limit"
            style={{ insetInlineStart: pct(limit) }}
            title="Limit"
          />
        )}
      </div>
    </div>
  );
}
