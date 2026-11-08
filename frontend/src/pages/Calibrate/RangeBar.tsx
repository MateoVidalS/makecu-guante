/** A track for a value range with optional markers. Purely visual; the values are also given as text. */
export function RangeBar({
  min,
  max,
  from,
  to,
  current,
  fromLabel = 'Slack',
  toLabel = 'Open',
  tone = 'active',
  compact = false,
}: {
  min: number;
  max: number;
  from?: number | null;
  to?: number | null;
  current?: number;
  fromLabel?: string;
  toLabel?: string;
  tone?: 'active' | 'reached' | 'caution';
  compact?: boolean;
}) {
  const pct = (v: number) =>
    `${Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100))}%`;
  const hasSpan = from != null && to != null;
  const lo = hasSpan ? Math.min(from!, to!) : 0;
  const hi = hasSpan ? Math.max(from!, to!) : 0;
  return (
    <div
      className={`cal-range${compact ? ' cal-range--compact' : ''}`}
      aria-hidden="true"
    >
      <div className="cal-range__track">
        {hasSpan && (
          <span
            className={`cal-range__span cal-range__span--${tone}`}
            style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }}
          />
        )}
        {from != null && (
          <span
            className="cal-range__mark cal-range__mark--from"
            style={{ left: pct(from) }}
          >
            {!compact && <span className="cal-range__tag">{fromLabel}</span>}
          </span>
        )}
        {to != null && (
          <span
            className="cal-range__mark cal-range__mark--to"
            style={{ left: pct(to) }}
          >
            {!compact && <span className="cal-range__tag">{toLabel}</span>}
          </span>
        )}
        {current != null && (
          <span className="cal-range__now" style={{ left: pct(current) }} />
        )}
      </div>
    </div>
  );
}
