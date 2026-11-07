import { Icon } from '../../design-system';
import type { AttemptOutcome } from './format';

export interface StripAttempt {
  /** Pose name shown under its group, e.g. "Hook". Omit to draw one flat row. */
  group?: string;
  outcome: AttemptOutcome;
}

const WORDS: Record<AttemptOutcome, string> = {
  own: 'Reached on your own',
  helped: 'Reached with the glove',
  paused: 'Paused',
  tried: 'Tried',
};

function Dot({ outcome }: { outcome: AttemptOutcome }) {
  return (
    <span className={`mx-dot mx-dot--${outcome}`} title={WORDS[outcome]}>
      {outcome === 'own' && <Icon name="check" size="0.8em" />}
    </span>
  );
}

/**
 * One dot per attempt, grouped by pose: filled = reached alone, half = with the glove,
 * ring = paused. Shape carries the meaning; color and the legend back it up.
 */
export function AttemptStrip({
  attempts,
  label = 'Your attempts',
}: {
  attempts: StripAttempt[];
  label?: string;
}) {
  const groups: { name?: string; items: StripAttempt[] }[] = [];
  for (const a of attempts) {
    const last = groups.at(-1);
    if (last && last.name === a.group) last.items.push(a);
    else groups.push({ name: a.group, items: [a] });
  }
  const used = new Set(attempts.map((a) => a.outcome));
  let n = 0;
  return (
    <div className="mx-strip">
      <ol className="mx-strip__groups" aria-label={label}>
        {groups.map((g, gi) => (
          <li key={gi} className="mx-strip__group">
            <ol className="mx-strip__dots" aria-label={g.name}>
              {g.items.map((a) => {
                n += 1;
                return (
                  <li key={n}>
                    <Dot outcome={a.outcome} />
                    <span className="mx-sr">
                      Attempt {n}: {WORDS[a.outcome]}
                    </span>
                  </li>
                );
              })}
            </ol>
            {g.name && (
              <span className="mx-strip__name" aria-hidden="true">
                {g.name}
              </span>
            )}
          </li>
        ))}
      </ol>
      <ul className="mx-legend" aria-hidden="true">
        {(['own', 'helped', 'paused', 'tried'] as const)
          .filter((o) => used.has(o) || o === 'own' || o === 'helped')
          .map((o) => (
            <li key={o}>
              <Dot outcome={o} />
              {WORDS[o]}
            </li>
          ))}
      </ul>
    </div>
  );
}
