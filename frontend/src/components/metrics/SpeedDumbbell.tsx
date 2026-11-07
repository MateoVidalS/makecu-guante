import { Badge, Icon, StatusDot } from '../../design-system';
import { fingerName } from './format';

export interface SpeedRow {
  finger: string;
  slow: number | null;
  fast: number | null;
  aborted?: boolean;
  /** Closure where the sweep stopped safely, 0..1. */
  abortedAt?: number | null;
}

/** "Stiffer at speed" when the fast pull needs clearly more force than the slow one. */
export function stifferAtSpeed(slow: number | null, fast: number | null) {
  if (slow == null || fast == null) return false;
  return fast - slow >= Math.max(15, Math.abs(slow) * 0.25);
}

const niceMax = (v: number) => {
  const step = v <= 100 ? 25 : v <= 300 ? 50 : 100;
  return Math.max(100, Math.ceil((v * 1.1) / step) * step);
};

/**
 * Per finger, slow vs fast resistance on one shared scale (mA above empty-glove friction).
 * Slow = open ring, fast = filled dot, joined by a line; both are labeled, so the
 * pair never relies on color. A callout flags fingers that are stiffer at speed.
 */
export function SpeedDumbbell({
  rows,
  label = 'Resistance when moved slowly and quickly, by finger',
  axisLabel = 'mA above glove friction',
}: {
  rows: SpeedRow[];
  label?: string;
  axisLabel?: string;
}) {
  const values = rows.flatMap((r) =>
    [r.slow, r.fast].filter((v): v is number => v != null),
  );
  const max = niceMax(Math.max(0, ...values));
  const x = (v: number) => `${(Math.max(0, Math.min(max, v)) / max) * 100}%`;
  const ticks = [0, max / 2, max];
  return (
    <div className="mx-bell">
      <ul className="mx-legend" aria-hidden="true">
        <li>
          <span className="mx-bell__key mx-bell__key--slow" />
          Slow move
        </li>
        <li>
          <span className="mx-bell__key mx-bell__key--fast" />
          Fast move
        </li>
      </ul>
      <ul className="mx-bell__rows" aria-label={label}>
        {rows.map((r) => {
          const stiff = stifferAtSpeed(r.slow, r.fast);
          const both = r.slow != null && r.fast != null;
          const lo = both ? Math.min(r.slow!, r.fast!) : 0;
          const hi = both ? Math.max(r.slow!, r.fast!) : 0;
          const words = [
            `slow ${r.slow == null ? 'no reading' : `${Math.round(r.slow)} mA`}`,
            `fast ${r.fast == null ? 'no reading' : `${Math.round(r.fast)} mA`}`,
            stiff ? 'stiffer at speed' : null,
          ]
            .filter(Boolean)
            .join(', ');
          return (
            <li key={r.finger} className="mx-bell__row">
              <span className="mx-bell__name">{fingerName(r.finger)}</span>
              <span
                className="mx-bell__track"
                role="img"
                aria-label={`${fingerName(r.finger)}: ${words}`}
              >
                {both && (
                  <span
                    className="mx-bell__bar"
                    style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }}
                  />
                )}
                {r.slow != null && (
                  <span
                    className="mx-bell__mark mx-bell__mark--slow"
                    style={{ left: x(r.slow) }}
                    title={`Slow: ${Math.round(r.slow)} mA`}
                  >
                    <span className="mx-bell__tag">
                      Slow {Math.round(r.slow)}
                    </span>
                  </span>
                )}
                {r.fast != null && (
                  <span
                    className="mx-bell__mark mx-bell__mark--fast"
                    style={{ left: x(r.fast) }}
                    title={`Fast: ${Math.round(r.fast)} mA`}
                  >
                    <span className="mx-bell__tag">
                      Fast {Math.round(r.fast)}
                    </span>
                  </span>
                )}
                {r.slow == null && r.fast == null && (
                  <span className="mx-bell__none">No reading</span>
                )}
              </span>
              <span className="mx-bell__note">
                {r.aborted ? (
                  <span className="mx-bell__stopped">
                    <StatusDot tone="caution" />
                    <span>Stopped safely</span>
                    {r.abortedAt != null && (
                      <span className="mx-muted">
                        {' '}
                        at{' '}
                        {Math.round(
                          Math.min(1, Math.max(0, r.abortedAt)) * 100,
                        )}
                        %
                      </span>
                    )}
                  </span>
                ) : stiff ? (
                  <Badge tone="neutral" icon="sparkline">
                    Stiffer at speed
                  </Badge>
                ) : both ? (
                  <span className="mx-muted">
                    <Icon name="check" /> Similar at both speeds
                  </span>
                ) : (
                  <span className="mx-muted">One speed only</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mx-bell__axis" aria-hidden="true">
        <span className="mx-bell__name" />
        <span className="mx-bell__ticks">
          {ticks.map((t) => (
            <span key={t} style={{ left: x(t) }}>
              {Math.round(t)}
            </span>
          ))}
          <span className="mx-bell__unit">{axisLabel}</span>
        </span>
        <span className="mx-bell__note" />
      </div>
    </div>
  );
}
