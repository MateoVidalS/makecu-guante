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

export type AttemptOutcome = 'own' | 'helped' | 'paused' | 'tried';
export function attemptOutcome(
  r: Pick<
    AttemptResult,
    'interrupted' | 'reached_active' | 'assisted' | 'reached_final'
  >,
): AttemptOutcome {
  if (r.interrupted) return 'paused';
  if (r.reached_active) return 'own';
  if (r.assisted) return 'helped';
  return 'tried';
}

/** One plain, honest sentence for the attempt (≤ 12 words, effort framing). */
export function attemptSentence(r: AttemptResult): string {
  switch (attemptOutcome(r)) {
    case 'own':
      return 'You did that on your own.';
    case 'helped':
      return 'Good effort. The glove helped with the rest.';
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
      delta: n != null && t != null ? Math.round((n - t) * 100) : null,
    };
  });
}

/** One encouraging sentence that stays true to the numbers. */
export function recapSentence(summary: SessionSummary): string {
  const deltas = fingerDeltas(
    summary.per_finger,
    summary.previous?.per_finger ?? null,
  ).filter((d) => d.delta != null);
  const best = deltas.reduce<FingerDelta | null>(
    (a, d) => (a == null || (d.delta ?? 0) > (a.delta ?? 0) ? d : a),
    null,
  );
  if (best && (best.delta ?? 0) >= 3)
    return `Your ${best.finger} closed further on its own than last time.`;
  const done = summary.attempts - summary.interrupted;
  if (done > 0 && summary.reached_active / done >= 0.5)
    return 'You reached most poses on your own. Steady work.';
  if (deltas.length && deltas.every((d) => Math.abs(d.delta ?? 0) < 3))
    return 'About the same as last time. Steady practice helps.';
  if (summary.attempts === 0) return 'Thanks for starting. Every try counts.';
  return 'Good effort today. The glove helped where needed.';
}
