import { clamp01, fingerName, pct } from './format';

export interface SplitRow {
  finger: string;
  own: number | null;
  help: number | null;
}

/**
 * Per finger: one bar from open (0%) to fully closed (100%).
 * Blue = how far it closed on its own, orange on top = what the glove added.
 */
export function SplitBars({
  rows,
  label = 'On your own and with the glove, by finger',
}: {
  rows: SplitRow[];
  label?: string;
}) {
  return (
    <div className="mx-split">
      <ul className="mx-legend" aria-hidden="true">
        <li>
          <i className="mx-swatch mx-fill--own" />
          On your own
        </li>
        <li>
          <i className="mx-swatch mx-fill--help" />
          Glove helped
        </li>
      </ul>
      <ul className="mx-split__rows" aria-label={label}>
        {rows.map((r) => {
          const own = clamp01(r.own ?? 0);
          const help = Math.min(clamp01(r.help ?? 0), 1 - own);
          const text =
            r.own == null
              ? 'No reading'
              : `${pct(r.own)} on your own${help > 0.005 ? `, glove helped ${pct(help)} more` : ''}`;
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
