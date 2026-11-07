import { useEffect, useState } from 'react';
import type { AttemptResult, SessionSummary } from '../../contracts/engine';
import { POSES } from '../../contracts/poses';
import { Card, Heading } from '../../design-system';
import { useRuntime } from '../../runtime';
import {
  AttemptStrip,
  SplitBars,
  ThenNow,
  attemptOutcome,
  fingerDeltas,
  recapSentence,
  type StripAttempt,
} from '../../components/metrics';

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

/** Without the per-attempt list (e.g. after a reload), draw the counts in a fixed order. */
function fromCounts(summary: SessionSummary): StripAttempt[] {
  const helped = summary.assisted;
  const own = summary.reached_active;
  const paused = summary.interrupted;
  const tried = Math.max(0, summary.attempts - own - helped - paused);
  return [
    ...Array<StripAttempt>(own).fill({ outcome: 'own' }),
    ...Array<StripAttempt>(helped).fill({ outcome: 'helped' }),
    ...Array<StripAttempt>(tried).fill({ outcome: 'tried' }),
    ...Array<StripAttempt>(paused).fill({ outcome: 'paused' }),
  ];
}

export function SessionRecap({
  summary,
  attempts,
  mirrored,
}: {
  summary: SessionSummary;
  attempts: AttemptResult[];
  mirrored?: boolean;
}) {
  const deltas = fingerDeltas(
    summary.per_finger,
    summary.previous?.per_finger ?? null,
  );
  const strip: StripAttempt[] = attempts.length
    ? [...attempts]
        .sort((a, b) => a.index - b.index)
        .map((a) => ({
          group: POSES[a.pose]?.name ?? a.pose,
          outcome: attemptOutcome(a),
        }))
    : fromCounts(summary);
  return (
    <div className="recap">
      <header className="recap__head">
        <Heading level={1}>Session complete</Heading>
        <p className="recap__counts">
          {summary.attempts} attempts · {summary.reached_active} on your own ·{' '}
          {summary.assisted} with help
        </p>
        <p className="recap__sentence">{recapSentence(summary)}</p>
      </header>
      <Card
        title={summary.previous ? 'Last time → today' : 'Your hand today'}
        description="How far each finger closed on its own."
      >
        <ThenNow deltas={deltas} mirrored={mirrored} size={128} />
        {!summary.previous && (
          <p className="recap__note">
            This is your starting point. Next time you will see the change.
          </p>
        )}
        <p className="recap__note">
          On your own and with the glove. Bar end = fully closed.
        </p>
        <SplitBars
          rows={summary.per_finger.map((f) => ({
            finger: f.finger,
            own: f.active_max_mean,
            help: f.assist_needed_mean,
          }))}
        />
      </Card>
      {strip.length > 0 && (
        <Card
          title="Every attempt"
          description={
            attempts.length ? 'In order, grouped by pose.' : 'Totals for today.'
          }
        >
          <AttemptStrip attempts={strip} />
        </Card>
      )}
      <p className="recap__note">
        Estimated from the camera, not a medical measurement.
      </p>
    </div>
  );
}
