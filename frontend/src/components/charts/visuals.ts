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
import {
  GLOVE_FINGERS,
  pullFromClosure,
  type GloveFinger,
} from '../../contracts/glove';
import type { AssistDirection } from '../../contracts/calibration';
import { directionOf, latestCohort } from './direction';
import { phaseBands, type TimelineEntry } from './transforms';
import {
  compareRange,
  compareResistance,
  meaningful,
  toPoints,
  RANGE_MARGIN_POINTS,
} from './thresholds';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pct = (v: number) => `${Math.round(v * 100)}%`;
/** Same format as `formatDate` (charts/index), kept here to avoid a circular import. */
const longDate = (value: string) =>
  new Date(value).toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
const byTime = (
  a: { started_at: string; id: number },
  b: { started_at: string; id: number },
) => Date.parse(a.started_at) - Date.parse(b.started_at) || a.id - b.id;

/* ---------- Which sessions have something to show ---------- */

/**
 * Whether a finished session has an active range to show: open-pose points for the
 * opening glove, the summary's per-finger range for the earlier closing glove.
 */
export function hasRangeData(session: Session, openingPoints?: RomPoint[]) {
  return directionOf(session) === 'open'
    ? !!openingPoints?.some(
        (p) => p.session_id === session.id && directionOf(p) === 'open',
      )
    : !!session.summary?.per_finger.some((f) => f.active_max_mean != null);
}

/** Copy for a newest session that had nothing to show, naming the session shown instead. */
export function skippedSessionNote(
  newest: { assist_direction?: AssistDirection } | undefined,
  shownDate: string,
) {
  return `Latest session had no ${directionOf(newest) === 'open' ? 'measured open-hand attempts' : 'range measurements'}; showing the session from ${longDate(shownDate)}.`;
}

export interface RangeSessions {
  /** Finished sessions with a range to show, one glove direction, oldest first. */
  measured: Session[];
  /** The newest finished session, with or without a range. */
  newest?: Session;
  direction: AssistDirection;
  /** Set when the newest finished session had no range and an older one is shown. */
  note?: string;
}

/**
 * Finished sessions to compare in range views. A short or interrupted session without
 * open-hand attempts (or an unfinished one) never blanks the views: the latest session
 * with data is shown, with a note naming its date.
 */
export function rangeSessions(
  sessions: Session[] | undefined,
  openingPoints?: RomPoint[],
): RangeSessions {
  const finished = (sessions ?? []).filter((s) => s.summary).sort(byTime);
  const measured = latestCohort(
    finished.filter((s) => hasRangeData(s, openingPoints)),
  ).sort(byTime);
  const newest = finished.at(-1),
    shown = measured.at(-1);
  return {
    measured,
    newest,
    direction: directionOf(shown ?? newest),
    note:
      newest && shown && newest.id !== shown.id
        ? skippedSessionNote(newest, shown.started_at)
        : undefined,
  };
}

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
  openingPoints?: RomPoint[],
): {
  first: HandValues;
  last: HandValues;
  assistDirection?: AssistDirection;
} {
  const first: HandValues = {},
    last: HandValues = {};
  if (sessions) {
    // The overview uses each finger's first measured session, which may be newer
    // than the date on the hand map when history mixes three and five fingers.
    // Sessions are whole: a finger missing from a measured session stays a gap.
    const { measured, direction } = rangeSessions(sessions, openingPoints);
    for (const [values, session] of [
      [first, measured[0]],
      [last, measured.at(-1)],
    ] as const) {
      if (!session) continue;
      if (directionOf(session) === 'open')
        GLOVE_FINGERS.forEach((finger) => {
          const point = openingPoints?.find(
            (p) =>
              p.session_id === session.id &&
              p.finger === finger &&
              directionOf(p) === 'open',
          );
          values[finger] = {
            own: point ? pullFromClosure(point.active_max_mean) : null,
          };
        });
      else
        session.summary?.per_finger.forEach((f) => {
          values[f.finger] = { own: f.active_max_mean };
        });
    }
    return { first, last, assistDirection: direction };
  }
  overview?.per_finger.forEach((f) => {
    first[f.finger] = { own: f.active_max_first };
    last[f.finger] = { own: f.active_max_last };
  });
  return { first, last };
}

/** Scored glove fingers of one attempt. The glove part is capped so own + glove never passes 100%. */
export function handFromAttempt(
  fingers: FingerAttemptMetrics[],
  assistDirection: AssistDirection = 'close',
): HandValues {
  const out: HandValues = {};
  fingers.forEach((f) => {
    if (!f.scored || !(GLOVE_FINGERS as string[]).includes(f.finger)) return;
    const opening =
      assistDirection === 'open' && f.target != null && f.target <= 0.05;
    const own =
      f.active_max == null
        ? null
        : opening
          ? pullFromClosure(f.active_max)
          : clamp01(f.active_max);
    out[f.finger as GloveFinger] = {
      own,
      glove:
        f.assist_needed == null
          ? null
          : Math.min(f.assist_needed, 1 - (own ?? 0)),
      target:
        opening && f.target != null ? pullFromClosure(f.target) : f.target,
    };
  });
  return out;
}

/* ---------- Active vs assisted ---------- */

export interface EffortPoint {
  sessionId: number;
  date: string;
  demo: boolean;
  assist_direction?: AssistDirection;
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
  const row = (
    id: number,
    date: string,
    demo: boolean,
    assist_direction?: AssistDirection,
  ) => {
    let r = rows.get(id);
    if (!r) {
      r = {
        sessionId: id,
        date,
        demo,
        assist_direction,
        own: null,
        glove: null,
        rate: null,
      };
      rows.set(id, r);
    }
    if (assist_direction) r.assist_direction = assist_direction;
    return r;
  };
  // Include every session, even when this finger was not measured.
  timeline.forEach((s) =>
    row(s.id, s.started_at, s.is_demo, s.assist_direction),
  );
  [...rom, ...assist].forEach((p) =>
    row(p.session_id, p.started_at, p.is_demo, p.assist_direction),
  );
  rom
    .filter((p) => p.finger === finger)
    .forEach((p) => {
      row(p.session_id, p.started_at, p.is_demo, p.assist_direction).own =
        clamp01(
          directionOf(p) === 'open'
            ? pullFromClosure(p.active_max_mean)
            : p.active_max_mean,
        );
    });
  assist
    .filter((p) => p.finger === finger)
    .forEach((p) => {
      const r = row(p.session_id, p.started_at, p.is_demo, p.assist_direction);
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
  const latest = points.at(-1);
  const measured = points.filter(
    (p) => p.own != null && directionOf(p) === directionOf(latest),
  );
  if (!measured.length) return `${cap(finger)}: not measured`;
  const first = measured[0].own!,
    last = measured.at(-1)!.own!;
  if (measured.length === 1) return `${cap(finger)}: ${pct(last)} on your own`;
  const change = compareRange(last, first);
  if (change > 0)
    return `${cap(finger)}: ${pct(first)} → ${pct(last)} on your own`;
  if (change < 0)
    return `${cap(finger)}: ${pct(last)} on your own, down from ${pct(first)}`;
  return `${cap(finger)}: about the same, ${pct(last)} on your own`;
}

type EffortTimelineEntry = TimelineEntry & {
  /** Present on sessions from the API: null until the session is finished. */
  summary?: unknown;
};

export interface LatestEffort {
  /** The latest finished session with an open-pose measurement on any finger. */
  session?: EffortPoint;
  /** One row per glove finger for that session; a finger it did not measure is a gap. */
  rows: { finger: GloveFinger; row?: EffortPoint }[];
  /** Set when a newer finished session had nothing to show. */
  note?: string;
}

/**
 * The "latest session" for the effort bars: the newest finished session that measured
 * something, never an unfinished or fist-only session that would blank every finger.
 */
export function latestEffort(
  series: { finger: GloveFinger; rows: EffortPoint[] }[],
  timeline: EffortTimelineEntry[] = [],
): LatestEffort {
  const unfinished = new Set(
    timeline.filter((s) => s.summary === null).map((s) => s.id),
  );
  const newestFirst = (a: EffortPoint, b: EffortPoint) =>
    Date.parse(b.date) - Date.parse(a.date) || b.sessionId - a.sessionId;
  const finished = series
    .flatMap((s) => s.rows)
    .filter((r) => !unfinished.has(r.sessionId))
    .sort(newestFirst);
  const session = finished.find((r) => r.own != null || r.glove != null);
  const newest = finished[0];
  return {
    session,
    rows: series.map(({ finger, rows }) => ({
      finger,
      row: !session
        ? undefined
        : (rows.find((r) => r.sessionId === session.sessionId) ?? {
            ...session,
            own: null,
            glove: null,
            rate: null,
          }),
    })),
    note:
      session && newest && newest.sessionId !== session.sessionId
        ? skippedSessionNote(newest, session.date)
        : undefined,
  };
}

/** Title for the latest effort bars: name a finger only when it clearly did the most. */
export function latestEffortTitle(
  rows: { finger: GloveFinger; row?: Pick<EffortPoint, 'own'> }[],
) {
  const ranked = rows
    .flatMap(({ finger, row }) =>
      row?.own == null ? [] : [{ finger, own: toPoints(row.own) }],
    )
    .sort((a, b) => b.own - a.own);
  if (ranked.length < 2) return 'Latest session';
  return meaningful(ranked[0].own, ranked[1].own, RANGE_MARGIN_POINTS) > 0
    ? `${cap(ranked[0].finger)} did the most on its own last time`
    : 'Fingers did about the same on their own last time';
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
  assist_direction?: AssistDirection;
  slow: number | null;
  fast: number | null;
  /** fast − slow: the speed-dependent part (spasticity proxy). */
  gap: number | null;
  /** The sweep stopped safely before it finished: shown, never compared. */
  stopped: boolean;
}

/** Evaluation records whose finger results say which sweeps stopped safely. */
export type StoppedSweeps = Pick<Evaluation, 'id' | 'fingers'>[];

/** A row with a measurement to show (slow or fast) from a sweep that finished. */
export const dumbbellShown = (r: DumbbellRow) =>
  (r.slow != null || r.fast != null) && !r.stopped;
/** A row whose fast − slow can be compared with another evaluation. */
export const dumbbellComparable = (r: DumbbellRow) =>
  r.gap != null && !r.stopped;

export function dumbbellRows(
  points: ResistancePoint[],
  evaluations: StoppedSweeps = [],
): Record<GloveFinger, DumbbellRow[]> {
  const out = {
    thumb: [],
    index: [],
    middle: [],
    ring: [],
    pinky: [],
  } as Record<GloveFinger, DumbbellRow[]>;
  const stopped = new Set(
    evaluations.flatMap((e) =>
      e.fingers.filter((f) => f.aborted).map((f) => `${e.id}-${f.finger}`),
    ),
  );
  const byEvaluation = new Map(points.map((p) => [p.evaluation_id, p]));
  const byFinger = new Map(
    points.map((p) => [`${p.evaluation_id}-${p.finger}`, p]),
  );
  // Legacy and subset evaluations retain a row for each unmeasured finger.
  byEvaluation.forEach((evaluation) => {
    GLOVE_FINGERS.forEach((finger) => {
      const key = `${evaluation.evaluation_id}-${finger}`;
      const p = byFinger.get(key);
      const slow = p?.slow ?? null;
      const fast = p?.fast ?? null;
      out[finger].push({
        evaluationId: evaluation.evaluation_id,
        date: evaluation.started_at,
        demo: evaluation.is_demo,
        assist_direction: evaluation.assist_direction,
        slow,
        fast,
        gap:
          p?.dependence ?? (slow != null && fast != null ? fast - slow : null),
        stopped: stopped.has(key),
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

/**
 * Rows the compact chart keeps per finger: the first evaluation with a finished
 * measurement and the latest one (the focus evaluation when it measured this finger).
 * An evaluation that stopped early or skipped a finger never hides the earlier result.
 */
export function compactDumbbellRows(
  rows: Record<GloveFinger, DumbbellRow[]>,
  focusId: number | undefined,
): Record<GloveFinger, DumbbellRow[]> {
  const out = {} as Record<GloveFinger, DumbbellRow[]>;
  GLOVE_FINGERS.forEach((f) => {
    const list = rows[f];
    const shown = list.filter(dumbbellShown);
    const focus = list.find((r) => r.evaluationId === focusId);
    const latest = focus && dumbbellShown(focus) ? focus : shown.at(-1);
    // Nothing finished for this finger: keep the focus row so the gap stays visible.
    const keep = new Set(latest ? [shown[0], latest] : [focus ?? list.at(-1)]);
    out[f] = list.filter((r) => keep.has(r));
  });
  return out;
}

/** Per finger: the comparable fast − slow values of the latest glove direction, oldest first. */
function comparableGaps(
  rows: Record<GloveFinger, DumbbellRow[]>,
  upTo?: number,
) {
  return GLOVE_FINGERS.map((finger) => ({
    finger,
    gaps: latestCohort(
      rows[finger]
        .filter((r) => upTo == null || Date.parse(r.date) <= upTo)
        .map((r) => ({ ...r, started_at: r.date })),
    )
      .filter(dumbbellComparable)
      .map((r) => r.gap!),
  }));
}

export function resistanceTakeaway(
  rows: Record<GloveFinger, DumbbellRow[]>,
  upTo?: number,
) {
  const perFinger = comparableGaps(rows, upTo);
  // Compare whole mA, as shown, and only past the margin: smaller moves are noise.
  const changes = perFinger
    .filter((f) => f.gaps.length > 1)
    .map((f) => ({
      finger: f.finger,
      dir: compareResistance(f.gaps.at(-1)!, f.gaps[0]),
    }));
  if (!changes.length) {
    // One evaluation per finger: describe fast against slow, not a change.
    const latest = perFinger.flatMap((f) =>
      f.gaps.length ? [compareResistance(f.gaps.at(-1)!, 0)] : [],
    );
    if (!latest.length) return 'No resistance measured yet';
    if (latest.every((d) => d > 0))
      return 'Fast sweeps met more resistance than slow ones';
    if (latest.every((d) => d === 0))
      return 'Fast and slow sweeps met about the same resistance';
    if (latest.every((d) => d < 0))
      return 'Slow sweeps met more resistance than fast ones';
    return 'Fast and slow resistance differed by finger';
  }
  const where = (dir: -1 | 1) => {
    const fingers = changes.filter((c) => c.dir === dir);
    if (fingers.length === GLOVE_FINGERS.length) return 'on every finger';
    if (fingers.length === changes.length)
      return fingers.length === 1
        ? `on the ${fingers[0].finger}`
        : 'on measured fingers';
    return 'on some fingers';
  };
  const eased = changes.some((c) => c.dir < 0),
    rose = changes.some((c) => c.dir > 0);
  if (eased && rose)
    return 'Speed-dependent resistance changed unevenly across fingers';
  if (eased) return `Speed-dependent resistance eased ${where(-1)}`;
  if (rose) return `Speed-dependent resistance rose ${where(1)}`;
  return 'Speed-dependent resistance stayed about the same';
}

/** One evaluation plus the one before it (from history), so the dumbbells show the change. */
export function compareWithPrevious(
  current: Pick<
    Evaluation,
    'id' | 'started_at' | 'fingers' | 'is_demo' | 'assist_direction'
  >,
  history: ResistancePoint[],
): ResistancePoint[] {
  const at = Date.parse(current.started_at);
  const earlier = history.filter(
    (p) =>
      p.evaluation_id !== current.id &&
      Date.parse(p.started_at) < at &&
      directionOf(p) === directionOf(current),
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
      assist_direction: current.assist_direction,
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
