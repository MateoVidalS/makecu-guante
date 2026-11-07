import type {
  AssistPoint,
  ResistancePoint,
  RomPoint,
} from '../../contracts/api';
import type { AttemptTrace, ExercisePhase } from '../../contracts/engine';
import type { GloveFinger } from '../../contracts/glove';

export interface TimelineEntry {
  id: number;
  started_at: string;
  is_demo: boolean;
}
export interface ChartRow {
  x: number;
  date?: string;
  demo: boolean;
  [key: string]: number | string | boolean | null | undefined;
}
const percent = (value: number | null | undefined) =>
  value == null ? null : value * 100;

// Align every finger to the same recorded sessions so missing measurements stay gaps.
function align<T extends { started_at: string; is_demo: boolean }>(
  points: T[],
  timeline: TimelineEntry[],
  id: (point: T) => number,
  values: (point: T | undefined) => Record<string, number | null>,
): ChartRow[] {
  const entries = new Map(timeline.map((s) => [s.id, s]));
  points.forEach((p) =>
    entries.set(id(p), {
      id: id(p),
      started_at: p.started_at,
      is_demo: p.is_demo,
    }),
  );
  const byId = new Map(points.map((p) => [id(p), p]));
  return [...entries.values()]
    .sort(
      (a, b) =>
        Date.parse(a.started_at) - Date.parse(b.started_at) || a.id - b.id,
    )
    .map((s) => ({
      x: Date.parse(s.started_at),
      date: s.started_at,
      demo: s.is_demo,
      ...values(byId.get(s.id)),
    }));
}
export function toFingerSeries(
  points: RomPoint[],
  finger: GloveFinger,
  timeline: TimelineEntry[] = [],
): ChartRow[] {
  return align(
    points.filter((p) => p.finger === finger),
    [
      ...points.map((p) => ({
        id: p.session_id,
        started_at: p.started_at,
        is_demo: p.is_demo,
      })),
      ...timeline,
    ],
    (p) => p.session_id,
    (p) => ({ active: percent(p?.active_max_mean) }),
  );
}
export function assistSeries(
  points: AssistPoint[],
  finger: GloveFinger,
  timeline: TimelineEntry[] = [],
): ChartRow[] {
  return align(
    points.filter((p) => p.finger === finger),
    [
      ...points.map((p) => ({
        id: p.session_id,
        started_at: p.started_at,
        is_demo: p.is_demo,
      })),
      ...timeline,
    ],
    (p) => p.session_id,
    (p) => ({
      needed: percent(p?.assist_needed_mean),
      rate: percent(p?.assisted_rate),
    }),
  );
}
export function resistanceSeries(
  points: ResistancePoint[],
  finger: GloveFinger,
  timeline: TimelineEntry[] = [],
): ChartRow[] {
  return align(
    points.filter((p) => p.finger === finger),
    [
      ...points.map((p) => ({
        id: p.evaluation_id,
        started_at: p.started_at,
        is_demo: p.is_demo,
      })),
      ...timeline,
    ],
    (p) => p.evaluation_id,
    (p) => ({
      slow: p?.slow ?? null,
      fast: p?.fast ?? null,
      dependence: p?.dependence ?? null,
    }),
  );
}
export interface PhaseBand {
  phase: ExercisePhase;
  start: number;
  end: number;
}
export function phaseBands(
  trace: Pick<AttemptTrace, 't' | 'phase'>,
): PhaseBand[] {
  const bands: PhaseBand[] = [];
  trace.t.forEach((t, i) => {
    const phase = trace.phase[i];
    if (!phase) return;
    const previous = bands.at(-1);
    if (previous?.phase === phase) previous.end = t;
    else {
      if (previous) previous.end = t;
      bands.push({ phase, start: t, end: t });
    }
  });
  return bands;
}

// Keep bucket extrema in every metric, missing-value boundaries, and phase changes.
// maxPoints is a soft limit: preserving a gap or safety context takes precedence.
export function decimate<T>(
  points: readonly T[],
  maxPoints: number,
  values: (p: T) => readonly (number | null)[],
  preserve: (p: T, previous: T) => boolean = () => false,
): T[] {
  if (!Number.isInteger(maxPoints) || maxPoints < 2)
    throw new RangeError('maxPoints must be at least 2');
  if (points.length <= maxPoints) return [...points];
  const selected = new Set([0, points.length - 1]);
  const metrics = values(points[0]).length;
  const buckets = Math.max(1, Math.floor(maxPoints / Math.max(2, metrics * 2)));
  const size = Math.ceil(points.length / buckets);
  for (let start = 0; start < points.length; start += size) {
    for (let metric = 0; metric < metrics; metric++) {
      let min = -1,
        max = -1;
      for (let i = start; i < Math.min(points.length, start + size); i++) {
        const v = values(points[i])[metric];
        if (v == null || !Number.isFinite(v)) continue;
        if (min === -1 || v < values(points[min])[metric]!) min = i;
        if (max === -1 || v > values(points[max])[metric]!) max = i;
      }
      if (min !== -1) selected.add(min);
      if (max !== -1) selected.add(max);
    }
  }
  for (let i = 1; i < points.length; i++) {
    if (
      preserve(points[i], points[i - 1]) ||
      values(points[i]).some(
        (v, j) => (v == null) !== (values(points[i - 1])[j] == null),
      )
    ) {
      selected.add(i - 1);
      selected.add(i);
    }
  }
  return [...selected].sort((a, b) => a - b).map((i) => points[i]);
}
