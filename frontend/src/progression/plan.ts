// Adaptive progression: "today's plan" from recent sessions (docs/plan/17-progression.md).
//
// The plan only ever makes practice easier or gives more time to try alone:
// - a per-finger opening target a little beyond what that finger opens alone (shaping,
//   "just-right challenge"), never above the full pose target (scale <= 1);
// - more seconds to try alone before help is offered, once most openings succeed alone
//   (help fades), within THERAPY_LIMITS.attempt_s.
// Glove speed, pull, current limits and every firmware safety rule are untouched, and a
// lower opening target also lowers how far the glove pulls when it helps.
import type { SessionDetail } from '../contracts/api';
import type { ExerciseSettings } from '../contracts/engine';
import type { ProgressionStart } from '../engine/types';
import { GLOVE_FINGERS } from '../contracts/glove';
import type { ProgressionChallenge } from '../contracts/progression';
import { THERAPY_LIMITS } from '../contracts/therapist';
import type { FingerId } from '../contracts/vision';

export const PROGRESSION = {
  /** Recent opening sessions considered. */
  window: 3,
  /** A finger is adapted only with measurements from at least this many sessions… */
  minSessions: 2,
  /** …and this many open-hand attempts. */
  minAttempts: 3,
  /** A finger that reaches the full opening alone this often keeps the full target. */
  fullTargetReachRate: 0.6,
  /** Opening asked beyond the finger's recent mean opening alone (before the reach tolerance). */
  margin: { standard: 0.1, gentle: 0.05 } satisfies Record<
    ProgressionChallenge,
    number
  >,
  /** Lowest target scale the plan sets; the coach may still go to THERAPY_LIMITS.target_scale[0]. */
  scaleFloor: 0.6,
  scaleStep: THERAPY_LIMITS.target_step,
  /** Share of open-hand attempts reached alone → extra seconds to try alone. */
  attemptSteps: [
    { reachRate: 0.7, extra_s: 2 },
    { reachRate: 0.4, extra_s: 1 },
  ],
  /** Gentle never adds more than one second. */
  gentleMaxExtra_s: 1,
  /** Pain or fatigue reported in the latest session keeps the standard trying time. */
  painHold: THERAPY_LIMITS.intensify_pain_block,
  fatigueHold: 6,
} as const;

export interface FingerPlan {
  finger: FingerId;
  /** Mean opening reached alone in open-hand attempts, 0..1; null without measurements. */
  opening_alone: number | null;
  /** Share of those attempts that reached the full opening alone. */
  reach_alone_rate: number | null;
  /** Enough recent measurements to adapt this finger. */
  measured: boolean;
  /** Fraction of each pose's opening asked of this finger today: 1 = the standard target. */
  target_scale: number;
  reason: string;
}

export interface TodaysPlan {
  status: 'adapted' | 'standard' | 'not_enough_data';
  challenge: ProgressionChallenge;
  /** Session ids the plan was computed from, newest first. */
  sessions: number[];
  is_demo: boolean;
  fingers: FingerPlan[];
  attempt_s: number;
  base_attempt_s: number;
  attempt_reason: string;
  /** True when anything differs from the standard plan. */
  changed: boolean;
}

const clamp = (n: number, low: number, high: number) =>
  Math.max(low, Math.min(high, n));
const mean = (values: number[]) =>
  values.reduce((a, b) => a + b, 0) / values.length;
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Completed opening-glove sessions with open-hand attempts, newest first. */
export function recentOpeningSessions(
  sessions: SessionDetail[],
  window: number = PROGRESSION.window,
): SessionDetail[] {
  return sessions
    .filter(
      (s) =>
        s.assist_direction === 'open' &&
        s.ended_at !== null &&
        s.attempts.some((a) => a.pose === 'open' && !a.interrupted),
    )
    .sort(
      (a, b) =>
        Date.parse(b.started_at) - Date.parse(a.started_at) || b.id - a.id,
    )
    .slice(0, window);
}

export function planToday(
  history: SessionDetail[],
  options: {
    challenge: ProgressionChallenge;
    /** Today's settings: the reach tolerance and the standard trying time. */
    settings: Pick<ExerciseSettings, 'tolerance' | 'attempt_s'>;
  },
): TodaysPlan {
  const { challenge, settings } = options;
  const recent = recentOpeningSessions(history);
  const base = settings.attempt_s;
  const attempts = recent.flatMap((s) =>
    s.attempts
      .filter((a) => a.pose === 'open' && !a.interrupted)
      .map((a) => ({ session: s, attempt: a })),
  );
  const fingers = GLOVE_FINGERS.map((finger): FingerPlan => {
    const measured = attempts.flatMap(({ session, attempt }) => {
      const m = attempt.fingers.find((f) => f.finger === finger);
      if (!m?.scored || m.active_max == null || !Number.isFinite(m.active_max))
        return [];
      const reachAt = (m.target ?? 0) + session.settings.tolerance;
      return [
        {
          session: session.id,
          opening: clamp(1 - m.active_max, 0, 1),
          reached: m.active_max <= reachAt + 1e-9,
        },
      ];
    });
    const sessionsMeasured = new Set(measured.map((m) => m.session)).size;
    if (
      sessionsMeasured < PROGRESSION.minSessions ||
      measured.length < PROGRESSION.minAttempts
    )
      return {
        finger,
        opening_alone: measured.length
          ? mean(measured.map((m) => m.opening))
          : null,
        reach_alone_rate: measured.length
          ? mean(measured.map((m) => (m.reached ? 1 : 0)))
          : null,
        measured: false,
        target_scale: 1,
        reason: 'Not enough recent practice yet: standard target.',
      };
    const opening = mean(measured.map((m) => m.opening));
    const reachRate = mean(measured.map((m) => (m.reached ? 1 : 0)));
    if (reachRate >= PROGRESSION.fullTargetReachRate)
      return {
        finger,
        opening_alone: opening,
        reach_alone_rate: reachRate,
        measured: true,
        target_scale: 1,
        reason: `Reached the full opening alone in ${pct(reachRate)} of recent tries: full target.`,
      };
    // Reached when opening >= scale − tolerance, so ask for (opening + margin) once the
    // tolerance is taken into account, rounded up to the coach's 0.1 step.
    const step = PROGRESSION.scaleStep;
    const wanted = opening + PROGRESSION.margin[challenge] + settings.tolerance;
    const scale = clamp(
      Math.ceil(wanted / step - 1e-9) * step,
      PROGRESSION.scaleFloor,
      1,
    );
    const rounded = Math.round(scale * 100) / 100;
    return {
      finger,
      opening_alone: opening,
      reach_alone_rate: reachRate,
      measured: true,
      target_scale: rounded,
      reason:
        rounded < 1
          ? `Opens about ${pct(opening)} alone: target set to ${pct(rounded)} of a full opening, a little beyond that.`
          : `Opens about ${pct(opening)} alone: full target.`,
    };
  });

  let attempt_s = base;
  let attempt_reason = 'Standard time to try alone.';
  if (
    attempts.length >= PROGRESSION.minAttempts &&
    recent.length >= PROGRESSION.minSessions
  ) {
    const reachRate = mean(
      attempts.map(({ attempt }) => (attempt.reached_active ? 1 : 0)),
    );
    const latest = recent[0];
    const strain = (latest.feelings ?? []).find(
      (f) =>
        f.pain >= PROGRESSION.painHold || f.fatigue >= PROGRESSION.fatigueHold,
    );
    const step = PROGRESSION.attemptSteps.find((s) => reachRate >= s.reachRate);
    if (strain && step)
      attempt_reason = `Kept at the standard time: ${strain.pain >= PROGRESSION.painHold ? 'pain' : 'fatigue'} was reported last session.`;
    else if (step) {
      const extra =
        challenge === 'gentle'
          ? Math.min(step.extra_s, PROGRESSION.gentleMaxExtra_s)
          : step.extra_s;
      attempt_s = clamp(
        base + extra,
        THERAPY_LIMITS.attempt_s[0],
        THERAPY_LIMITS.attempt_s[1],
      );
      if (attempt_s > base)
        attempt_reason = `Opened alone in ${pct(reachRate)} of recent tries: help is offered after ${attempt_s} s instead of ${base} s.`;
    } else
      attempt_reason = `Opened alone in ${pct(reachRate)} of recent tries: standard time to try alone.`;
  }
  const changed = attempt_s !== base || fingers.some((f) => f.target_scale < 1);
  const measuredAny = fingers.some((f) => f.measured);
  return {
    status: changed ? 'adapted' : measuredAny ? 'standard' : 'not_enough_data',
    challenge,
    sessions: recent.map((s) => s.id),
    is_demo: recent.some((s) => s.is_demo),
    fingers,
    attempt_s,
    base_attempt_s: base,
    attempt_reason,
    changed,
  };
}

/** One line for the audit log and the coach. */
export function planSummary(plan: TodaysPlan): string {
  const lowered = plan.fingers.filter((f) => f.target_scale < 1);
  const parts = [
    lowered.length
      ? lowered.map((f) => `${f.finger} ${pct(f.target_scale)}`).join(', ') +
        ' of a full opening'
      : 'full opening targets',
    plan.attempt_s !== plan.base_attempt_s
      ? `${plan.attempt_s} s to try alone`
      : `standard ${plan.base_attempt_s} s to try alone`,
  ];
  return `Today's plan from ${plan.sessions.length} recent sessions (${plan.challenge}): ${parts.join('; ')}.`;
}

/**
 * Today's settings with the plan applied. Unchanged (same object) when the plan is off,
 * missing or standard, so the default practice never differs from before.
 */
export function applyPlan<T extends ExerciseSettings>(
  settings: T,
  plan: TodaysPlan | null,
): T | (T & { progression: ProgressionStart }) {
  if (!plan?.changed) return settings;
  const target_scale: Partial<Record<FingerId, number>> = {};
  for (const f of plan.fingers)
    if (f.target_scale < 1) target_scale[f.finger] = f.target_scale;
  const attempt_s = clamp(
    Math.max(settings.attempt_s, plan.attempt_s),
    THERAPY_LIMITS.attempt_s[0],
    THERAPY_LIMITS.attempt_s[1],
  );
  return {
    ...settings,
    attempt_s,
    progression: {
      target_scale,
      attempt_s,
      challenge: plan.challenge,
      sessions: plan.sessions,
      summary: planSummary(plan),
    },
  };
}
