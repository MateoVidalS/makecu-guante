import type { Session, RomPoint } from '../../contracts/api';
import { pullFromClosure } from '../../contracts/glove';
import { directionOf } from '../../components/charts/direction';
import { rangeSessions } from '../../components/charts/visuals';
import { RANGE_MARGIN_POINTS } from '../../components/charts/thresholds';
import { fingerDeltas, type FingerDelta } from '../../components/metrics';

const WEEK = 7 * 86_400_000;

export interface RangeComparison {
  latest: Session;
  deltas: FingerDelta[];
  thenLabel: string;
  changeText: string;
  /** Set when the newest session had no range and an older one is shown. */
  note?: string;
}

/**
 * The latest finished session with a range to show, compared with the last such session
 * at least a week older ("a week ago"), else with the one before it ("last time").
 * A fist-only or interrupted session is skipped (with a note), never shown as empty.
 */
export function rangeComparison(
  sessions: Session[],
  openingPoints?: RomPoint[],
): RangeComparison | null {
  const { measured, note } = rangeSessions(sessions, openingPoints);
  const latest = measured.at(-1);
  if (!latest?.summary) return null;
  const t = Date.parse(latest.started_at);
  const earlier = measured.slice(0, -1).reverse();
  const weekAgo = earlier.find((s) => Date.parse(s.started_at) <= t - WEEK);
  const before = weekAgo ?? earlier[0];
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
  const then = weekAgo ? 'a week before' : 'the time before';
  // Changes under the margin are camera noise as much as progress: call them steady.
  const changeText = !before
    ? 'Your first range. The change will show after your next session.'
    : !known.length
      ? 'No finger was measured in both sessions, so there is no change to show yet.'
      : best && best.delta! >= RANGE_MARGIN_POINTS
        ? `Your ${best.finger} ${opening ? 'opens' : 'closes'} further on its own than ${then}.`
        : known.every((d) => Math.abs(d.delta!) < RANGE_MARGIN_POINTS)
          ? `About the same as ${then}. Steady.`
          : `A little lower than ${then}. Tired days happen.`;
  return { latest, deltas, thenLabel, changeText, note };
}
