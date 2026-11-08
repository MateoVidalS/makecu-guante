import { Icon } from '../../design-system';
import { clamp01, fingerName, pct } from './format';

/** `stopped`: the glove stopped helping because this finger resisted. */
export type GaugeState = 'idle' | 'active' | 'assist' | 'reached' | 'stopped';

/**
 * A tall live gauge for one glove finger (0% open at the bottom, 100% closed at the top).
 * - the goal is a band (target ± tolerance) with a word next to it;
 * - the fill is the live position: blue while the patient moves alone, the part above
 *   their own best turns orange while the glove helps;
 * - a tick marks the best they reached on their own this attempt.
 * Reads from 1 m without numbers; the % under it is a bonus.
 */
export function FingerGauge({
  finger,
  value,
  best,
  target,
  tolerance = 0.1,
  state,
  assisting = state === 'assist',
  highlighted = false,
}: {
  finger: string;
  /** Live closure 0..1, null when the hand isn't seen. */
  value: number | null;
  /** Best closure on their own this attempt (for an open target: the most open). */
  best: number | null;
  /** Pose target; null = free finger (not scored). */
  target: number | null;
  tolerance?: number;
  state: GaugeState;
  /** Retain the helped segment after reaching, while other fingers finish. */
  assisting?: boolean;
  highlighted?: boolean;
}) {
  const free = target == null;
  const opening = target != null && target <= 0.05;
  const v = value == null ? null : clamp01(value);
  const b = best == null ? null : clamp01(best);
  const lo = target == null ? 0 : clamp01(target - tolerance);
  const hi = target == null ? 0 : clamp01(target + tolerance);
  const inBand =
    state !== 'idle' &&
    v != null &&
    target != null &&
    (opening ? v <= hi : v >= target - tolerance);
  // Keep camera values in closure units. Opening help spans live → active best.
  const helping =
    assisting && state !== 'idle' && b != null && v != null && v < b;
  const own = v ?? 0;
  const help = helping ? b! - v! : 0;
  const stopped = !free && state === 'stopped';
  const status = free
    ? 'Free'
    : stopped
      ? 'Stopped'
      : v == null
        ? 'Not seen'
        : inBand
          ? 'Reached'
          : helping && help > 0.01
            ? 'Glove helping'
            : '';
  const valueText = [
    v == null ? 'not seen' : pct(v),
    free ? 'free finger' : `goal ${pct(target)}`,
    b != null && !free ? `best on your own ${pct(b)}` : null,
    status && !free ? status.toLowerCase() : null,
    highlighted ? 'coach focus' : null,
  ]
    .filter(Boolean)
    .join(', ');
  const pos = (n: number) => `${n * 100}%`;
  return (
    <div
      className="mx-gauge"
      data-highlighted={highlighted || undefined}
      data-state={
        free
          ? 'free'
          : stopped
            ? 'stopped'
            : inBand
              ? 'reached'
              : helping
                ? 'assist'
                : state
      }
    >
      <span className="mx-gauge__name">
        {highlighted && <span aria-hidden="true">↓</span>}
        {stopped && <Icon name="caution" className="mx-gauge__icon" />}
        {status === 'Reached' && (
          <Icon name="check" className="mx-gauge__icon" />
        )}
        {status === 'Glove helping' && (
          <Icon name="glove" className="mx-gauge__icon" />
        )}
        {fingerName(finger)}
      </span>
      <div
        className="mx-gauge__track"
        role="meter"
        aria-label={fingerName(finger)}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={v ?? 0}
        aria-valuetext={valueText}
      >
        {own > 0.005 && (
          <span
            className="mx-gauge__fill mx-fill--own"
            style={{ height: pos(own) }}
          />
        )}
        {help > 0.005 && (
          <span
            className="mx-gauge__fill mx-gauge__fill--help mx-fill--help"
            style={{ bottom: pos(own), height: pos(help) }}
            title="Glove helped you open"
          />
        )}
        {!free && (
          <span
            className="mx-gauge__band"
            style={{ bottom: pos(lo), height: pos(Math.max(0.02, hi - lo)) }}
            title={`Goal ${pct(target)}`}
          />
        )}
        {b != null && !free && (
          <span
            className="mx-gauge__best"
            style={{ bottom: pos(b) }}
            title={`Best on your own ${pct(b)}`}
          />
        )}
      </div>
      <span className="mx-gauge__value">{v == null ? '—' : pct(v)}</span>
      <span className="mx-gauge__status">{status || '\u00a0'}</span>
    </div>
  );
}

/** The key under the gauges: the three marks in words. */
export function GaugeLegend() {
  return (
    <ul
      className="mx-legend mx-legend--gauge"
      aria-label="How to read the bars"
    >
      <li>
        <i className="mx-swatch mx-fill--own" aria-hidden="true" />
        On your own
      </li>
      <li>
        <i className="mx-swatch mx-fill--help" aria-hidden="true" />
        Glove
      </li>
      <li>
        <i className="mx-swatch mx-swatch--band" aria-hidden="true" />
        Goal
      </li>
    </ul>
  );
}
