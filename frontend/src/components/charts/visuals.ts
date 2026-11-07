// Pure data shaping for the visual metrics (hand map, effort bars, calendar, dumbbells, phase strip).
import type {
  AssistPoint,
  Evaluation,
  HistoryOverview,
  ResistancePoint,
  RomPoint,
  Session,
} from '../../contracts/api';
import type {
  AttemptTrace,
  ExercisePhase,
  FingerAttemptMetrics,
} from '../../contracts/engine';
import { GLOVE_FINGERS, type GloveFinger } from '../../contracts/glove';
import { phaseBands, type TimelineEntry } from './transforms';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pct = (v: number) => `${Math.round(v * 100)}%`;

/* ---------- Hand map ---------- */

/** One glove finger on the hand map: what the patient did, what the glove added, the target. 0..1. */
export interface HandValue {
  own: number | null;
  glove?: number | null;
  target?: number | null;
}
export type HandValues = Partial<Record<GloveFinger, HandValue>>;

export function handFromOverview(
  overview: HistoryOverview | undefined,
  sessions?: Session[],
): {
  first: HandValues;
  last: HandValues;
} {
  const first: HandValues = {},
    last: HandValues = {};
  if (sessions) {
    // The overview uses each finger's first measured session, which may be newer
    // than the date on the hand map when history mixes three and five fingers.
    const ordered = sessions
      .filter((s) => s.summary)
      .sort(
        (a, b) =>
          Date.parse(a.started_at) - Date.parse(b.started_at) || a.id - b.id,
      );
    ordered[0]?.summary?.per_finger.forEach((f) => {
      first[f.finger] = { own: f.active_max_mean };
    });
    ordered.at(-1)?.summary?.per_finger.forEach((f) => {
      last[f.finger] = { own: f.active_max_mean };
    });
    return { first, last };
  }
  overview?.per_finger.forEach((f) => {
    first[f.finger] = { own: f.active_max_first };
    last[f.finger] = { own: f.active_max_last };
  });
  return { first, last };
}

/** Scored glove fingers of one attempt. The glove part is capped so own + glove never passes 100%. */
export function handFromAttempt(fingers: FingerAttemptMetrics[]): HandValues {
  const out: HandValues = {};
  fingers.forEach((f) => {
    if (!f.scored || !(GLOVE_FINGERS as string[]).includes(f.finger)) return;
    const own = f.active_max == null ? null : clamp01(f.active_max);
    out[f.finger as GloveFinger] = {
      own,
      glove:
        f.assist_needed == null
          ? null
          : Math.min(f.assist_needed, 1 - (own ?? 0)),
      target: f.target,
    };
  });
  return out;
}

/* ---------- Active vs assisted ---------- */

export interface EffortPoint {
  sessionId: number;
  date: string;
  demo: boolean;
  /** Best closure on their own, 0..1. */
  own: number | null;
  /** The extra the glove had to add to reach the target, 0..1 (capped at 1 − own). */
  glove: number | null;
  /** Share of attempts the glove helped with, 0..1. */
  rate: number | null;
}

/** Join active range and assistance per session for one finger, oldest first. */
export function effortSeries(
  rom: RomPoint[],
  assist: AssistPoint[],
  finger: GloveFinger,
  timeline: TimelineEntry[] = [],
): EffortPoint[] {
  const rows = new Map<number, EffortPoint>();
  const row = (id: number, date: string, demo: boolean) => {
    let r = rows.get(id);
    if (!r) {
      r = { sessionId: id, date, demo, own: null, glove: null, rate: null };
      rows.set(id, r);
    }
    return r;
  };
  // Include every session, even when this finger was not measured.
  timeline.forEach((s) => row(s.id, s.started_at, s.is_demo));
  [...rom, ...assist].forEach((p) =>
    row(p.session_id, p.started_at, p.is_demo),
  );
  rom
    .filter((p) => p.finger === finger)
    .forEach((p) => {
      row(p.session_id, p.started_at, p.is_demo).own = clamp01(
        p.active_max_mean,
      );
    });
  assist
    .filter((p) => p.finger === finger)
    .forEach((p) => {
      const r = row(p.session_id, p.started_at, p.is_demo);
      r.glove = clamp01(p.assist_needed_mean);
      r.rate = clamp01(p.assisted_rate);
    });
  return [...rows.values()]
    .map((r) => ({
      ...r,
      glove: r.glove == null ? null : Math.min(r.glove, 1 - (r.own ?? 0)),
    }))
    .sort(
      (a, b) =>
        Date.parse(a.date) - Date.parse(b.date) || a.sessionId - b.sessionId,
    );
}

export function effortTakeaway(points: EffortPoint[], finger: GloveFinger) {
  const measured = points.filter((p) => p.own != null);
  if (!measured.length) return `${cap(finger)}: not measured`;
  const first = measured[0].own!,
    last = measured.at(-1)!.own!;
  if (measured.length === 1) return `${cap(finger)}: ${pct(last)} on your own`;
  if (Math.round(last * 100) > Math.round(first * 100))
    return `${cap(finger)}: ${pct(first)} → ${pct(last)} on your own`;
  if (Math.round(last * 100) < Math.round(first * 100))
    return `${cap(finger)}: ${pct(last)} on your own, down from ${pct(first)}`;
  return `${cap(finger)}: steady at ${pct(last)} on your own`;
}

/* ---------- Practice calendar ---------- */

export interface CalendarDay {
  /** YYYY-MM-DD, UTC. */
  date: string;
  attempts: number;
  sessions: number;
  demo: boolean;
  future: boolean;
}
const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const startOfUtcDay = (ms: number) => Math.floor(ms / DAY) * DAY;
/** Monday-based weekday, 0 = Monday. */
const weekday = (ms: number) => (new Date(ms).getUTCDay() + 6) % 7;

/** Attempts per day in five steps. 0 means no practice. */
export const attemptLevel = (attempts: number) =>
  attempts <= 0
    ? 0
    : attempts < 2
      ? 1
      : attempts < 5
        ? 2
        : attempts < 10
          ? 3
          : 4;

/** Weeks (Monday first) from the first session (at least minWeeks, at most maxWeeks back) to today. */
export function practiceCalendar(
  sessions: { started_at: string; n_attempts: number; is_demo: boolean }[],
  today: Date | number = Date.now(),
  minWeeks = 8,
  maxWeeks = 26,
) {
  const todayMs = startOfUtcDay(+today);
  const byDay = new Map<string, CalendarDay>();
  sessions.forEach((s) => {
    const key = isoDay(Date.parse(s.started_at));
    const d = byDay.get(key) ?? {
      date: key,
      attempts: 0,
      sessions: 0,
      demo: true,
      future: false,
    };
    d.attempts += Math.max(0, s.n_attempts);
    d.sessions += 1;
    d.demo &&= s.is_demo;
    byDay.set(key, d);
  });
  const lastMonday = todayMs - weekday(todayMs) * DAY;
  const firstSession = sessions.length
    ? Math.min(...sessions.map((s) => startOfUtcDay(Date.parse(s.started_at))))
    : todayMs;
  const needed = Math.ceil((lastMonday - firstSession) / (7 * DAY)) + 1;
  const count = Math.min(maxWeeks, Math.max(minWeeks, needed));
  const weeks: CalendarDay[][] = [];
  for (let w = count - 1; w >= 0; w--) {
    const monday = lastMonday - w * 7 * DAY;
    weeks.push(
      Array.from({ length: 7 }, (_, i) => {
        const ms = monday + i * DAY;
        const key = isoDay(ms);
        return (
          byDay.get(key) ?? {
            date: key,
            attempts: 0,
            sessions: 0,
            demo: false,
            future: ms > todayMs,
          }
        );
      }),
    );
  }
  const recent = (days: number) =>
    [...byDay.values()].filter((d) => {
      const ms = Date.parse(d.date);
      return ms <= todayMs && ms > todayMs - days * DAY && d.sessions > 0;
    }).length;
  return {
    weeks,
    days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    last7: recent(7),
    last28: recent(28),
  };
}

export function calendarTakeaway(last7: number, last28: number) {
  if (last28 === 0) return 'No practice in the last 4 weeks';
  return `Practiced ${last7} of the last 7 days, ${last28} of the last 28`;
}

/* ---------- Resistance dumbbells ---------- */

export interface DumbbellRow {
  evaluationId: number;
  date: string;
  demo: boolean;
  slow: number | null;
  fast: number | null;
  /** fast − slow: the speed-dependent part (spasticity proxy). */
  gap: number | null;
}

export function dumbbellRows(
  points: ResistancePoint[],
): Record<GloveFinger, DumbbellRow[]> {
  const out = {
    thumb: [],
    index: [],
    middle: [],
    ring: [],
    pinky: [],
  } as Record<GloveFinger, DumbbellRow[]>;
  const evaluations = new Map(points.map((p) => [p.evaluation_id, p]));
  const byFinger = new Map(
    points.map((p) => [`${p.evaluation_id}-${p.finger}`, p]),
  );
  // Legacy and subset evaluations retain a row for each unmeasured finger.
  evaluations.forEach((evaluation) => {
    GLOVE_FINGERS.forEach((finger) => {
      const p = byFinger.get(`${evaluation.evaluation_id}-${finger}`);
      const slow = p?.slow ?? null;
      const fast = p?.fast ?? null;
      out[finger].push({
        evaluationId: evaluation.evaluation_id,
        date: evaluation.started_at,
        demo: evaluation.is_demo,
        slow,
        fast,
        gap:
          p?.dependence ?? (slow != null && fast != null ? fast - slow : null),
      });
    });
  });
  GLOVE_FINGERS.forEach((f) =>
    out[f].sort(
      (a, b) =>
        Date.parse(a.date) - Date.parse(b.date) ||
        a.evaluationId - b.evaluationId,
    ),
  );
  return out;
}

/** Shared mA domain for every row, rounded out to 50 mA. */
export function dumbbellDomain(rows: DumbbellRow[]): [number, number] {
  const values = rows.flatMap((r) =>
    [r.slow, r.fast].filter((v): v is number => v != null),
  );
  if (!values.length) return [0, 100];
  // Positions, not lengths: the axis starts near the data, not at zero.
  const lo = Math.max(0, Math.floor(Math.min(...values) / 50) * 50 - 50);
  const hi = Math.max(lo + 50, Math.ceil(Math.max(...values) / 50) * 50);
  return [lo, hi];
}

export function resistanceTakeaway(
  rows: Record<GloveFinger, DumbbellRow[]>,
  upTo?: number,
) {
  const changes = GLOVE_FINGERS.flatMap((f) => {
    const list = rows[f].filter(
      (r) => r.gap != null && (upTo == null || Date.parse(r.date) <= upTo),
    );
    return list.length > 1 ? [list.at(-1)!.gap! - list[0].gap!] : [];
  });
  if (!changes.length) {
    const any = GLOVE_FINGERS.some((f) => rows[f].some((r) => r.gap != null));
    return any
      ? 'Fast sweeps met more resistance than slow ones'
      : 'No resistance measured yet';
  }
  if (changes.every((c) => c < 0))
    return changes.length === GLOVE_FINGERS.length
      ? 'Speed-dependent resistance eased on every finger'
      : 'Speed-dependent resistance eased on measured fingers';
  if (changes.every((c) => c > 0))
    return changes.length === GLOVE_FINGERS.length
      ? 'Speed-dependent resistance rose on every finger'
      : 'Speed-dependent resistance rose on measured fingers';
  if (changes.every((c) => c === 0))
    return 'Speed-dependent resistance held steady';
  return 'Speed-dependent resistance changed unevenly across fingers';
}

/** One evaluation plus the one before it (from history), so the dumbbells show the change. */
export function compareWithPrevious(
  current: Pick<Evaluation, 'id' | 'started_at' | 'fingers' | 'is_demo'>,
  history: ResistancePoint[],
): ResistancePoint[] {
  const at = Date.parse(current.started_at);
  const earlier = history.filter(
    (p) => p.evaluation_id !== current.id && Date.parse(p.started_at) < at,
  );
  const previousId = [...earlier].sort(
    (a, b) => Date.parse(b.started_at) - Date.parse(a.started_at),
  )[0]?.evaluation_id;
  return [
    ...earlier.filter((p) => p.evaluation_id === previousId),
    ...current.fingers.map((f) => ({
      evaluation_id: current.id,
      started_at: current.started_at,
      finger: f.finger,
      slow: f.resistance_slow_ma,
      fast: f.resistance_fast_ma,
      dependence: f.velocity_dependence_ma,
      is_demo: current.is_demo,
    })),
  ];
}

/* ---------- Phase strip ---------- */

export type PhaseKind =
  'active' | 'hold' | 'assist' | 'assistHold' | 'neutral' | 'paused';
export const PHASE_INFO: Record<
  ExercisePhase,
  { kind: PhaseKind; label: string }
> = {
  PRESENT: { kind: 'neutral', label: 'Get ready' },
  ATTEMPT: { kind: 'active', label: 'On your own' },
  HOLD: { kind: 'hold', label: 'Hold' },
  ASSIST: { kind: 'assist', label: 'Glove helping' },
  ASSIST_HOLD: { kind: 'assistHold', label: 'Glove holding' },
  RELEASE: { kind: 'neutral', label: 'Release' },
  PAUSED: { kind: 'paused', label: 'Paused' },
  REST: { kind: 'neutral', label: 'Rest' },
  DONE: { kind: 'neutral', label: 'Done' },
};

export interface PhaseSegment {
  phase: ExercisePhase;
  kind: PhaseKind;
  label: string;
  start: number;
  end: number;
}
export function phaseSegments(
  trace: Pick<AttemptTrace, 't' | 'phase'> | undefined,
): PhaseSegment[] {
  if (!trace) return [];
  return phaseBands(trace)
    .filter((b) => b.end > b.start)
    .map((b) => ({ ...b, ...PHASE_INFO[b.phase] }));
}
