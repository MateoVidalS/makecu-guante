import { useEffect, useState } from 'react';
import type { AttemptResult, SessionSummary } from '../../contracts/engine';
import { POSES } from '../../contracts/poses';
import { Card, Heading } from '../../design-system';
import { useExerciseView, useRuntime, useSavingStatus } from '../../runtime';
import {
  AttemptStrip,
  SplitBars,
  ThenNow,
  attemptOutcome,
  easedAtResistance,
  fingerDeltas,
  recapCounts,
  recapCountsText,
  recapSentence,
  type StripAttempt,
} from '../../components/metrics';
import {
  openingByFinger,
  useRecapComparison,
  type RecapAttempt,
  type RecapComparison,
} from './recapData';

/** Collects this session's attempt results as they finish (reset when a new session starts). */
export function useSessionAttempts() {
  const runtime = useRuntime();
  const [attempts, setAttempts] = useState<AttemptResult[]>([]);
  useEffect(
    () =>
      runtime.exercise.onEvent((e) => {
        if (e.kind === 'phase' && e.index === 0 && e.phase === 'PRESENT')
          setAttempts([]);
        else if (e.kind === 'attempt_done')
          setAttempts((list) =>
            list.some((a) => a.index === e.result.index)
              ? list
              : [...list, e.result],
          );
      }),
    [runtime],
  );
  return attempts;
}

const RESISTANCE_NOTE = 'It eased off when it felt resistance';

function stripOf(attempts: readonly RecapAttempt[]): StripAttempt[] {
  return [...attempts]
    .sort((a, b) => a.index - b.index)
    .map((a) => {
      const outcome = attemptOutcome(a);
      return {
        group: POSES[a.pose]?.name ?? a.pose,
        outcome,
        note:
          outcome !== 'paused' && a.assisted && easedAtResistance(a)
            ? RESISTANCE_NOTE
            : undefined,
      };
    });
}

/**
 * The recap once the session is over. It renders straight away from the live results; when the
 * session has been saved, the stored copy adds the comparison with the previous session.
 */
export function SessionRecap({
  summary,
  attempts,
  mirrored,
}: {
  summary: SessionSummary;
  attempts: AttemptResult[];
  mirrored?: boolean;
}) {
  const sessionId = useExerciseView((v) => v.sessionId);
  const saved = useSavingStatus() === 'Saved';
  // Errors and slow answers leave the recap as it is: the comparison is an addition.
  const comparison = useRecapComparison(sessionId, saved);
  return (
    <SessionRecapView
      summary={summary}
      attempts={attempts}
      mirrored={mirrored}
      comparison={comparison.data ?? null}
    />
  );
}

export function SessionRecapView({
  summary,
  attempts,
  mirrored,
  comparison,
}: {
  summary: SessionSummary;
  attempts: readonly RecapAttempt[];
  mirrored?: boolean;
  /** The saved session with `summary.previous`; null while loading or when unavailable. */
  comparison: RecapComparison | null;
}) {
  // Live results first; when they are gone (the page was left and reopened), the saved ones.
  const list = attempts.length ? attempts : (comparison?.attempts ?? []);
  const today = openingByFinger(list);
  const previous = comparison?.summary.previous;
  // `summary.previous` says whether and with which session to compare. Its own numbers are
  // all-pose means (fists mixed with openings), so the deltas use that session's openings instead:
  // the same measure as today's. Not found = no deltas (a gap), never a mixed comparison.
  const thenFingers = comparison?.then
    ? openingByFinger(comparison.then.attempts)
    : null;
  const deltas = fingerDeltas(
    today,
    thenFingers?.some((f) => f.active_max_mean != null) ? thenFingers : null,
  );
  const demo = comparison?.then?.session.is_demo ?? false;
  const counts = recapCounts(summary, list);
  const strip = stripOf(list);
  const anyGlove = today.some((f) => (f.glove_added_mean ?? 0) > 0.005);
  return (
    <div className="recap">
      <header className="recap__head">
        <Heading level={1}>Session complete</Heading>
        <p className="recap__counts">{recapCountsText(counts)}</p>
        <p className="recap__sentence">{recapSentence(summary, list)}</p>
      </header>
      <Card
        title="Your active opening today"
        description="How far each finger opened on its own, in every pose where it had to open."
      >
        <ThenNow
          deltas={deltas}
          mirrored={mirrored}
          size={128}
          thenLabel={demo ? 'Last time (demo data)' : 'Last time'}
        />
        {comparison && previous === null && (
          <p className="recap__note">
            This is your starting point. Next time you will see the change.
          </p>
        )}
        <p className="recap__note">
          {anyGlove
            ? 'On your own and with the glove. Bar end = fully open.'
            : 'Bar end = fully open.'}
        </p>
        <SplitBars
          rows={today.map((f) => ({
            finger: f.finger,
            own: f.active_max_mean,
            help: f.glove_added_mean,
          }))}
        />
      </Card>
      {strip.length > 0 && (
        <Card title="Every attempt" description="In order, grouped by pose.">
          <AttemptStrip attempts={strip} />
        </Card>
      )}
      <p className="recap__note">
        Estimated from the camera, not a medical measurement.
      </p>
    </div>
  );
}
