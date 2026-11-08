import { useEffect, useState } from 'react';
import type { AttemptResult } from '../../contracts/engine';
import { GLOVE_FINGERS } from '../../contracts/glove';
import { Icon, type IconName } from '../../design-system';
import { HandGlyph } from './HandGlyph';
import {
  attemptFills,
  attemptOutcome,
  attemptSentence,
  fingerName,
  pct,
} from './format';

const ICON: Record<ReturnType<typeof attemptOutcome>, IconName> = {
  own: 'check',
  helped: 'glove',
  paused: 'pause',
  tried: 'hand',
};

/** Pure card: a small hand with the five glove fingers filled, plus one sentence. */
export function AttemptFeedbackCard({
  result,
  mirrored = false,
}: {
  result: AttemptResult;
  mirrored?: boolean;
}) {
  const fills = attemptFills(result);
  const outcome = attemptOutcome(result);
  const sentence = attemptSentence(result);
  const handLabel = GLOVE_FINGERS.filter((f) => fills[f])
    .map((f) => {
      const fill = fills[f]!;
      return `${fingerName(f)} ${pct(fill.own)} of the way on your own${
        fill.help > 0.01 ? `, glove helped ${pct(fill.help)}` : ''
      }`;
    })
    .join('; ');
  return (
    <div
      className="attempt-toast mx-attempt"
      data-outcome={outcome}
      role="status"
      aria-live="polite"
    >
      <HandGlyph
        fills={fills}
        size={44}
        mirrored={mirrored}
        label={handLabel || 'Your hand this attempt'}
      />
      <div className="mx-attempt__text">
        <strong className="mx-attempt__title">
          <span className="mx-attempt__icon">
            <Icon name={ICON[outcome]} />
          </span>
          {sentence}
        </strong>
        {result.safety_events.some((e) => e.source === 'load_shed') && (
          <span className="mx-load-shed">Eased off to protect the glove</span>
        )}
        {outcome !== 'paused' && (
          <span className="mx-legend mx-legend--inline" aria-hidden="true">
            <span>
              <i className="mx-swatch mx-fill--own" />
              On your own
            </span>
            {result.assisted && (
              <span>
                <i className="mx-swatch mx-fill--help" />
                Glove helped
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

/** In-flow feedback after each attempt; hides itself after 4 s. */
export function AttemptFeedback({
  result,
  mirrored,
  duration = 4000,
}: {
  result: AttemptResult | null;
  mirrored?: boolean;
  duration?: number;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(!!result);
    const timer = setTimeout(() => setVisible(false), duration);
    return () => clearTimeout(timer);
  }, [result, duration]);
  if (!result || !visible) return null;
  return <AttemptFeedbackCard result={result} mirrored={mirrored} />;
}
