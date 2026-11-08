import type {
  AttemptResult,
  FingerAttemptMetrics,
  SessionSummary,
} from '../../contracts/engine';
import { GLOVE_FINGERS, type GloveFinger } from '../../contracts/glove';

export const clamp01 = (v: number) =>
  Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
/** Whole percent, or "—" for missing data (never 0). */
export const pct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `${Math.round(clamp01(v) * 100)}%`;
export const fingerName = (f: string) => f.charAt(0).toUpperCase() + f.slice(1);

/** One finger's share of the goal, the way the engine scores `active_ratio` (06-session §4). */
export function goalShare(
  value: number | null,
  target: number | null,
): number | null {
  if (value == null || target == null) return null;
  // An "open" target (≈ 0) is scored by how far the finger opened.
  if (target <= 0.05) return clamp01(1 - value);
  return clamp01(value / target);
}

export interface FingerFill {
  /** 0..1 of the goal reached on the patient's own. */
  own: number;
  /** 0..1 of the goal the glove added on top. */
  help: number;
}

/** Per glove finger: how far toward the goal on their own, and what the glove added. Unscored → null. */
export function attemptFills(
  result: AttemptResult,
): Record<GloveFinger, FingerFill | null> {
  const out = {} as Record<GloveFinger, FingerFill | null>;
  for (const finger of GLOVE_FINGERS) {
    const m: FingerAttemptMetrics | undefined = result.fingers.find(
      (f) => f.finger === finger,
    );
    if (!m || !m.scored || m.target == null) {
      out[finger] = null;
      continue;
    }
    const own = goalShare(m.active_max, m.target) ?? 0;
    let help = 0;
    if (result.assisted) {
      const final = goalShare(m.final, m.target);
      help =
        final != null
          ? Math.max(0, final - own)
          : result.reached_final
            ? 1 - own
            : 0;
    }
    out[finger] = { own, help: Math.min(help, 1 - own) };
  }
  return out;
}

/**
 * How one attempt ended, in the patient's words. "helped" means the pose was reached with the
 * glove (`reached_final`); an assisted attempt that did not get there is only "partial".
 */
export type AttemptOutcome = 'own' | 'helped' | 'partial' | 'paused' | 'tried';
export type OutcomeFields = Pick<
  AttemptResult,
  'interrupted' | 'reached_active' | 'assisted' | 'reached_final'
>;
export function attemptOutcome(r: OutcomeFields): AttemptOutcome {
  if (r.interrupted) return 'paused';
  if (r.reached_active) return 'own';
  if (r.assisted) return r.reached_final ? 'helped' : 'partial';
  return 'tried';
}
/** The glove met resistance and eased off (a calm stop, not a success). */
export const easedAtResistance = (r: Pick<AttemptResult, 'safety_events'>) =>
  r.safety_events.some((e) => e.source === 'resistance');

/** One plain, honest sentence for the attempt (≤ 12 words, effort framing). */
export function attemptSentence(r: AttemptResult): string {
  switch (attemptOutcome(r)) {
    case 'own':
      return 'You did that on your own.';
    case 'helped':
      return 'Good effort. The glove helped with the rest.';
    case 'partial':
      return easedAtResistance(r)
        ? 'Good effort. The glove felt resistance and eased off.'
        : 'Good effort. The glove went part of the way.';
    case 'paused':
      return 'We paused here. Rest, then carry on.';
    default:
      return 'Good try. Keep going.';
  }
}

export interface FingerDelta {
  finger: GloveFinger;
  now: number | null;
  then: number | null;
  /** Whole percentage points; null when either side is missing. */
  delta: number | null;
}
export function fingerDeltas(
  now: { finger: GloveFinger; active_max_mean: number | null }[],
  then: { finger: GloveFinger; active_max_mean: number | null }[] | null,
): FingerDelta[] {
  return GLOVE_FINGERS.map((finger) => {
    const n = now.find((f) => f.finger === finger)?.active_max_mean ?? null;
    const t = then?.find((f) => f.finger === finger)?.active_max_mean ?? null;
    return {
      finger,
      now: n,
      then: t,
      delta:
        n != null && t != null
          ? Math.round((clamp01(n) - clamp01(t)) * 100)
          : null,
    };
  });
}

export interface RecapCounts {
  attempts: number;
  /** Reached on your own. */
  own: number;
  /** Reached with the glove; null when only session totals are known. */
  helped: number | null;
  /** The glove assisted but the pose was not reached; null when unknown. */
  partial: number | null;
  /** Of those partial attempts, the ones where the glove eased off at resistance. */
  resisted: number;
  /** Attempts the glove assisted, reached or not. */
  assisted: number;
  /** Interrupted (paused, skipped or ended) before the attempt finished. */
  ended: number;
}
type RecapAttempt = OutcomeFields & Pick<AttemptResult, 'safety_events'>;

/** Session counts from the attempt list when there is one, else from the stored totals. */
export function recapCounts(
  summary: SessionSummary,
  attempts: readonly RecapAttempt[] = [],
): RecapCounts {
  if (!attempts.length)
    return {
      attempts: summary.attempts,
      own: summary.reached_active,
      helped: null,
      partial: null,
      resisted: 0,
      assisted: summary.assisted,
      ended: summary.interrupted,
    };
  const count = (o: AttemptOutcome) =>
    attempts.filter((a) => attemptOutcome(a) === o).length;
  return {
    attempts: attempts.length,
    own: count('own'),
    helped: count('helped'),
    partial: count('partial'),
    resisted: attempts.filter(
      (a) => attemptOutcome(a) === 'partial' && easedAtResistance(a),
    ).length,
    assisted: attempts.filter((a) => a.assisted).length,
    ended: count('paused'),
  };
}

/** "8 attempts · 2 on your own · 4 with help · 1 part way · 1 ended early". */
export function recapCountsText(c: RecapCounts): string {
  const parts = [
    `${c.attempts} ${c.attempts === 1 ? 'attempt' : 'attempts'}`,
    `${c.own} on your own`,
    // Without the attempt list, reached-with-the-glove is unknown: say only that the glove took part.
    c.helped == null ? `${c.assisted} with the glove` : `${c.helped} with help`,
  ];
  if (c.partial) parts.push(`${c.partial} part way`);
  if (c.ended) parts.push(`${c.ended} ended early`);
  return parts.join(' · ');
}

/**
 * One encouraging sentence that stays true to the numbers: the glove is only credited when it
 * actually helped a pose to completion.
 */
export function recapSentence(
  summary: SessionSummary,
  attempts: readonly RecapAttempt[] = [],
): string {
  const c = recapCounts(summary, attempts);
  if (c.attempts === 0) return 'Thanks for starting. Every try counts.';
  const done = c.attempts - c.ended;
  if (done <= 0) return 'Short session today. Rest, then try again later.';
  if (c.own / done >= 0.5)
    return 'You reached most poses on your own. Steady work.';
  if (c.helped) return 'Good effort today. The glove helped where needed.';
  if (c.resisted)
    return 'Good effort today. The glove eased off when it felt resistance.';
  if (c.partial) return 'Good effort today. The glove went part of the way.';
  return 'Good effort today. Every try counts.';
}
