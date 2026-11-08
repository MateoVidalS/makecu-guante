import { Icon } from '../../design-system';
import type { AttemptOutcome } from './format';

export interface StripAttempt {
  /** Pose name shown under its group, e.g. "Hook". Omit to draw one flat row. */
  group?: string;
  outcome: AttemptOutcome;
  /** Extra detail for this attempt, e.g. why the glove eased off. */
  note?: string;
}

const OUTCOME_WORDS: Record<AttemptOutcome, string> = {
  own: 'Reached on your own',
  helped: 'Reached with the glove',
  partial: 'Part way with the glove',
  paused: 'Ended early',
  tried: 'Tried',
};
const ORDER: AttemptOutcome[] = ['own', 'helped', 'partial', 'paused', 'tried'];

function Dot({ outcome, note }: { outcome: AttemptOutcome; note?: string }) {
  return (
    <span
      className={`mx-dot mx-dot--${outcome}`}
      title={
        note ? `${OUTCOME_WORDS[outcome]}. ${note}` : OUTCOME_WORDS[outcome]
      }
    >
      {outcome === 'own' && <Icon name="check" size="0.8em" />}
    </span>
  );
}

/**
 * One dot per attempt, grouped by pose: filled = reached alone, half = reached with the glove,
 * half with an orange ring = the glove went part of the way, grey ring = ended early.
 * Shape carries the meaning; color and the legend back it up.
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
                    <Dot outcome={a.outcome} note={a.note} />
                    <span className="mx-sr">
                      Attempt {n}: {OUTCOME_WORDS[a.outcome]}
                      {a.note ? `. ${a.note}` : ''}
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
      {/* Only outcomes that happened today, so the legend never suggests a result that did not occur. */}
      <ul className="mx-legend" aria-hidden="true">
        {ORDER.filter((o) => used.has(o)).map((o) => (
          <li key={o}>
            <Dot outcome={o} />
            {OUTCOME_WORDS[o]}
          </li>
        ))}
      </ul>
    </div>
  );
}
