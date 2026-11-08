import { useEffect, useRef, useState } from 'react';
import type { ExercisePhase, AttemptResult } from '../../contracts/engine';

export type TickKind = 'own' | 'helped';

/**
 * When to celebrate: the hold just finished (HOLD → RELEASE means the pose was reached on
 * your own and held), or a glove-helped attempt ended reached (its result arrives in REST).
 * Once per attempt.
 */
export function tickFor(
  previous: ExercisePhase | null,
  phase: ExercisePhase,
  result: AttemptResult | null,
  index: number,
): TickKind | null {
  if (previous === 'HOLD' && phase === 'RELEASE') return 'own';
  if (phase === 'REST' && result && result.index === index) {
    if (result.reached_active) return 'own';
    if (result.assisted && result.reached_final) return 'helped';
  }
  return null;
}

/** A big check that draws itself in the middle of the stage, like a delivery-app "done". */
export function SuccessTick({
  phase,
  index,
  result,
  duration = 1600,
}: {
  phase: ExercisePhase;
  index: number;
  result: AttemptResult | null;
  duration?: number;
}) {
  const previous = useRef<ExercisePhase | null>(null);
  const shownFor = useRef<number | null>(null);
  const [kind, setKind] = useState<TickKind | null>(null);
  useEffect(() => {
    const next = tickFor(previous.current, phase, result, index);
    previous.current = phase;
    if (!next || shownFor.current === index) return;
    shownFor.current = index;
    setKind(next);
  }, [phase, index, result]);
  // The hide timer depends only on the tick being shown. (It used to live in the effect
  // above, whose cleanup cancelled it at the next phase change: RELEASE lasts 0.5 s,
  // so "Perfect!" stayed on screen forever.)
  useEffect(() => {
    if (!kind) return;
    const timer = setTimeout(() => setKind(null), duration);
    return () => clearTimeout(timer);
  }, [kind, duration]);
  if (!kind) return null;
  return (
    <div className={`success-tick success-tick--${kind}`} role="status">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="success-tick__circle" cx="60" cy="60" r="50" />
        <path className="success-tick__check" d="M38 62 L54 78 L84 46" />
      </svg>
      <strong className="success-tick__label">
        {kind === 'own' ? 'Perfect!' : 'Done!'}
      </strong>
    </div>
  );
}
