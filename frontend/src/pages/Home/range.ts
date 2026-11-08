import type { Session, RomPoint } from '../../contracts/api';
import { pullFromClosure } from '../../contracts/glove';
import { latestCohort, directionOf } from '../../components/charts/direction';
import { fingerDeltas, type FingerDelta } from '../../components/metrics';

const WEEK = 7 * 86_400_000;

export interface RangeComparison {
  latest: Session;
  deltas: FingerDelta[];
  thenLabel: string;
  changeText: string;
}

/**
 * The latest finished session's active range, compared with the last session at least a
 * week older ("a week ago"), else with the session before it ("last time").
 */
export function rangeComparison(
  sessions: Session[],
  openingPoints?: RomPoint[],
): RangeComparison | null {
  const done = latestCohort(sessions.filter((s) => s.summary)).sort(
    (a, b) => Date.parse(b.started_at) - Date.parse(a.started_at),
  );
  const latest = done[0];
  if (!latest?.summary) return null;
  const t = Date.parse(latest.started_at);
  const weekAgo = done.find((s) => Date.parse(s.started_at) <= t - WEEK);
  const before = weekAgo ?? done[1];
  const opening = directionOf(latest) === 'open';
  const values = (session: Session | undefined) =>
    opening
      ? (openingPoints ?? [])
          .filter(
            (p) => p.session_id === session?.id && directionOf(p) === 'open',
          )
          .map((p) => ({
            finger: p.finger,
            active_max_mean: pullFromClosure(p.active_max_mean),
          }))
      : (session?.summary?.per_finger ?? []);
  // Stored summary.previous has no direction metadata; use a known same-direction session.
  const deltas = fingerDeltas(values(latest), before ? values(before) : null);
  const thenLabel = weekAgo ? 'A week before' : 'Time before';
  const known = deltas.filter((d) => d.delta != null);
  const best = known.reduce<FingerDelta | null>(
    (a, d) => (a == null || d.delta! > a.delta! ? d : a),
    null,
  );
  const since = weekAgo ? 'than a week before' : 'than the time before';
  const changeText = !known.length
    ? 'Your first range. The change will show after your next session.'
    : best && best.delta! >= 3
      ? `Your ${best.finger} ${opening ? 'opens' : 'closes'} further on its own ${since}.`
      : known.every((d) => Math.abs(d.delta!) < 3)
        ? `About the same ${since}. Steady.`
        : `A little lower ${since}. Tired days happen.`;
  return { latest, deltas, thenLabel, changeText };
}
