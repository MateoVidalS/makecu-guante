import { clamp01, fingerName, pct } from './format';

export interface SplitRow {
  finger: string;
  /** How far the finger got on its own, 0..1 of the way. Null = no reading. */
  own: number | null;
  /** What the glove measurably added on top (vision at the end of its hold). Null = no glove. */
  help: number | null;
}

/**
 * Per finger: one bar showing active opening plus the opening the glove actually added.
 * Blue = on your own, orange on top = added by the glove, the empty rest = still to open.
 * Orange only ever means the glove helped: a remaining gap is never drawn in orange.
 */
export function SplitBars({
  rows,
  label = 'On your own and with the glove, by finger',
}: {
  rows: SplitRow[];
  label?: string;
}) {
  // No reading = an empty track (a gap, not zero), with nothing stacked on it.
  const share = (r: SplitRow) => {
    if (r.own == null) return { own: 0, help: 0 };
    const own = clamp01(r.own);
    return { own, help: Math.min(clamp01(r.help ?? 0), 1 - own) };
  };
  const anyHelp = rows.some((r) => share(r).help > 0.005);
  return (
    <div className="mx-split">
      <ul className="mx-legend" aria-hidden="true">
        <li>
          <i className="mx-swatch mx-fill--own" />
          On your own
        </li>
        {anyHelp && (
          <li>
            <i className="mx-swatch mx-fill--help" />
            Glove added
          </li>
        )}
        <li>
          <i className="mx-swatch mx-swatch--track" />
          Still to open
        </li>
      </ul>
      <ul className="mx-split__rows" aria-label={label}>
        {rows.map((r) => {
          const { own, help } = share(r);
          const text =
            r.own == null
              ? 'No reading'
              : `${pct(r.own)} on your own${help > 0.005 ? `, the glove added ${pct(help)}` : ''}`;
          return (
            <li key={r.finger} className="mx-split__row">
              <span className="mx-split__name">{fingerName(r.finger)}</span>
              <span
                className="mx-split__track"
                role="img"
                aria-label={`${fingerName(r.finger)}: ${text}`}
              >
                {own > 0.005 && (
                  <span
                    className="mx-split__seg mx-fill--own"
                    style={{ width: `${own * 100}%` }}
                  />
                )}
                {help > 0.005 && (
                  <span
                    className="mx-split__seg mx-split__seg--help mx-fill--help"
                    style={{ left: `${own * 100}%`, width: `${help * 100}%` }}
                  />
                )}
              </span>
              <span className="mx-split__value">
                {pct(r.own)}
                {help > 0.005 && (
                  <span className="mx-split__help">
                    <i className="mx-swatch mx-fill--help" aria-hidden="true" />
                    +{pct(help)}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
