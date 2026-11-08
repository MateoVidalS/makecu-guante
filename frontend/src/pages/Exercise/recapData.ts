import { useQuery } from '@tanstack/react-query';
import { getSession, getSessions } from '../../api/client';
import type { Attempt, Session } from '../../contracts/api';
import type { AttemptResult, SessionSummary } from '../../contracts/engine';
import {
  GLOVE_FINGERS,
  pullFromClosure,
  type GloveFinger,
} from '../../contracts/glove';
import { POSES, opensFinger } from '../../contracts/poses';

/** A finished attempt, live (with its trace) or as saved (without it). */
export type RecapAttempt = Omit<AttemptResult, 'trace'>;
type Previous = NonNullable<SessionSummary['previous']>;

export interface FingerOpening {
  finger: GloveFinger;
  /** Mean opening reached on the patient's own, 0..1 of the calibrated range. */
  active_max_mean: number | null;
  /**
   * Mean opening the glove measurably added on top (vision at the end of its hold), over the same
   * readings. Null when the glove did not assist any finished attempt for this finger.
   */
  glove_added_mean: number | null;
}

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

/**
 * Per glove finger, over every pose where it had to open (the open hand, and the raised fingers
 * of finger-by-finger poses): how far it opened on its own, and what the glove actually added.
 * Never the remaining deficit (`assist_needed`): that is what was left to open, not the glove's work.
 */
export function openingByFinger(
  attempts: readonly RecapAttempt[],
): FingerOpening[] {
  return GLOVE_FINGERS.map((finger) => {
    const readings = attempts.flatMap((a) => {
      const pose = POSES[a.pose];
      if (!pose || !opensFinger(pose, finger)) return [];
      return a.fingers
        .filter((f) => f.finger === finger && f.scored && f.active_max != null)
        .map((f) => ({ a, f, own: pullFromClosure(f.active_max!) }));
    });
    // Only a finished, assisted attempt can credit the glove; an interrupted one stopped early.
    const glove = (a: RecapAttempt) => a.assisted && !a.interrupted;
    const added = readings.map(({ a, f, own }) =>
      glove(a) && f.final != null
        ? Math.max(0, pullFromClosure(f.final) - own)
        : 0,
    );
    return {
      finger,
      active_max_mean: mean(readings.map((r) => r.own)),
      glove_added_mean: readings.some((r) => glove(r.a)) ? mean(added) : null,
    };
  });
}

const same = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null ? a == null && b == null : Math.abs(a - b) < 1e-9;
const time = (s: Pick<Session, 'started_at'>) => Date.parse(s.started_at);

/**
 * The earlier session whose numbers the backend copied into `summary.previous`: same glove
 * direction, started before this one, and with exactly those stored numbers. The backend prefers
 * real sessions over demo ones, then the newest. Null when it is not in the list.
 */
export function findPreviousSession(
  sessions: readonly Session[],
  current: Pick<Session, 'id' | 'started_at' | 'assist_direction'>,
  previous: Previous,
): Session | null {
  const direction = current.assist_direction ?? 'close';
  return (
    sessions
      .filter(
        (s) =>
          s.id !== current.id &&
          s.summary != null &&
          (s.assist_direction ?? 'close') === direction &&
          (time(s) < time(current) ||
            (time(s) === time(current) && s.id < current.id)) &&
          same(s.summary.active_ratio_mean, previous.active_ratio_mean) &&
          previous.per_finger.every((p) =>
            same(
              s.summary!.per_finger.find((f) => f.finger === p.finger)
                ?.active_max_mean,
              p.active_max_mean,
            ),
          ),
      )
      .sort(
        (a, b) =>
          Number(a.is_demo) - Number(b.is_demo) ||
          time(b) - time(a) ||
          b.id - a.id,
      )[0] ?? null
  );
}

export interface RecapComparison {
  /** Today's summary as the backend stored it, with `previous` filled in. */
  summary: SessionSummary;
  /** Today's saved attempts (without traces). */
  attempts: Attempt[];
  /** The earlier session behind `summary.previous`, with its attempts, when it could be found. */
  then: { session: Session; attempts: Attempt[] } | null;
}

/** The session has no stored summary yet (its end is still being saved). */
class NotSavedYet extends Error {}

export async function loadRecapComparison(
  id: number,
): Promise<RecapComparison> {
  const detail = await getSession(id);
  if (!detail.summary) throw new NotSavedYet('Session end not saved yet');
  const previous = detail.summary.previous;
  let then: RecapComparison['then'] = null;
  if (previous) {
    // `previous` keeps only all-pose means, which mix fists and openings. To compare the same
    // measure as today, read that session's attempts. If that fails, the recap shows no deltas.
    try {
      const match = findPreviousSession(
        await getSessions({ limit: 200 }),
        detail,
        previous,
      );
      if (match)
        then = {
          session: match,
          attempts: (await getSession(match.id)).attempts,
        };
    } catch {
      then = null;
    }
  }
  return { summary: detail.summary, attempts: detail.attempts, then };
}

/**
 * Once the session is saved, the stored copy carries `summary.previous` (the engine's local
 * summary never does). Loads in the background: the recap renders without it meanwhile.
 */
export function useRecapComparison(sessionId: number | null, saved: boolean) {
  return useQuery({
    queryKey: ['sessions', sessionId, 'recap'],
    queryFn: () => loadRecapComparison(sessionId!),
    enabled: sessionId != null && saved,
    staleTime: Infinity,
    retry: (count, error) => error instanceof NotSavedYet && count < 5,
    retryDelay: 1000,
  });
}
