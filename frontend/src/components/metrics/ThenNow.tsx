import type { GloveFinger } from '../../contracts/glove';
import { Icon } from '../../design-system';
import { HandGlyph } from './HandGlyph';
import { fingerName, pct, type FingerDelta } from './format';

const fills = (deltas: FingerDelta[], side: 'now' | 'then') =>
  Object.fromEntries(
    deltas.map((d) => [
      d.finger,
      d[side] == null ? null : { own: d[side]!, help: 0 },
    ]),
  ) as Record<GloveFinger, { own: number; help: number } | null>;

/** "+15" with ▲ for better, "−3" with a muted ▼ for lower (never red). */
export function DeltaText({
  delta,
  unit = '',
}: {
  delta: number | null;
  unit?: string;
}) {
  if (delta == null) return <span className="mx-delta">—</span>;
  if (delta === 0) return <span className="mx-delta mx-delta--flat">Same</span>;
  const up = delta > 0;
  return (
    <span className={`mx-delta mx-delta--${up ? 'up' : 'down'}`}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>
      {up ? '+' : '−'}
      {Math.abs(delta)}
      {unit}
      <span className="mx-sr">{up ? ' (better)' : ' (lower)'}</span>
    </span>
  );
}

/**
 * Two small hands side by side: how far each finger closed on its own then, and now.
 * Per-finger deltas sit under "now". With no earlier session, only "now" is drawn.
 */
export function ThenNow({
  deltas,
  thenLabel = 'Last time',
  nowLabel = 'Today',
  size = 104,
  mirrored,
}: {
  deltas: FingerDelta[];
  thenLabel?: string;
  nowLabel?: string;
  size?: number;
  mirrored?: boolean;
}) {
  const hasThen = deltas.some((d) => d.then != null);
  const describe = (side: 'now' | 'then') =>
    deltas.map((d) => `${fingerName(d.finger)} ${pct(d[side])}`).join(', ');
  return (
    <div className="mx-thennow">
      {hasThen && (
        <>
          <figure className="mx-thennow__hand mx-thennow__hand--then">
            <HandGlyph
              fills={fills(deltas, 'then')}
              size={size}
              mirrored={mirrored}
              label={`${thenLabel}: ${describe('then')}`}
            />
            <figcaption>{thenLabel}</figcaption>
          </figure>
          <span className="mx-thennow__arrow" aria-hidden="true">
            <Icon name="arrow-right" size="1.6em" />
          </span>
        </>
      )}
      <figure className="mx-thennow__hand">
        <HandGlyph
          fills={fills(deltas, 'now')}
          size={size}
          mirrored={mirrored}
          label={`${nowLabel}: ${describe('now')}`}
        />
        <figcaption>{nowLabel}</figcaption>
      </figure>
      <dl className="mx-thennow__list">
        {deltas.map((d) => (
          <div key={d.finger} className="mx-thennow__row">
            <dt>{fingerName(d.finger)}</dt>
            <dd>
              <span className="mx-thennow__value">{pct(d.now)}</span>
              {hasThen && <DeltaText delta={d.delta} />}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
