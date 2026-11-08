// "Latest with data" selection and the headline margins (QA X-01 and X-03).
import { describe, expect, it } from 'vitest';
import type {
  AssistPoint,
  ResistancePoint,
  RomPoint,
  Session,
} from '../../contracts/api';
import { GLOVE_FINGERS, type GloveFinger } from '../../contracts/glove';
import {
  compareRange,
  compareResistance,
  meaningful,
  RANGE_MARGIN_POINTS,
  RESISTANCE_MARGIN_MA,
} from './thresholds';
import {
  compactDumbbellRows,
  dumbbellRows,
  effortSeries,
  effortTakeaway,
  handFromOverview,
  latestEffort,
  latestEffortTitle,
  rangeSessions,
  resistanceTakeaway,
} from './visuals';
import { trendTakeaway } from './index';

const at = (day: string) => `2026-11-${day}T10:00:00Z`;
const session = (
  id: number,
  day: string,
  { finished = true, direction = 'open' as Session['assist_direction'] } = {},
): Session => ({
  id,
  mode: 'exercise',
  started_at: at(day),
  ended_at: finished ? at(day) : null,
  calibration_id: 1,
  plan: [{ pose: 'open', reps: 2 }],
  settings: {} as Session['settings'],
  is_demo: false,
  summary: finished
    ? {
        attempts: 2,
        reached_active: 1,
        assisted: 1,
        interrupted: 0,
        active_ratio_mean: 0.5,
        per_pose: [],
        per_finger: [],
        previous: null,
      }
    : null,
  n_attempts: finished ? 2 : 0,
  assist_direction: direction,
});
/** Open-pose camera closure for each listed finger (active opening = 1 − closure). */
const openPoints = (
  id: number,
  day: string,
  closure: number,
  fingers: readonly GloveFinger[] = GLOVE_FINGERS,
): RomPoint[] =>
  fingers.map((finger) => ({
    session_id: id,
    started_at: at(day),
    finger,
    pose: 'open',
    active_max_mean: closure,
    is_demo: false,
    assist_direction: 'open',
  }));
const assistPoints = (id: number, day: string, need: number): AssistPoint[] =>
  GLOVE_FINGERS.map((finger) => ({
    session_id: id,
    started_at: at(day),
    finger,
    assist_needed_mean: need,
    assisted_rate: 1,
    is_demo: false,
    assist_direction: 'open',
  }));

// Two measured sessions, then a fist-only session and an unfinished one with 0 attempts.
const history = [
  session(1, '01'),
  session(2, '05'),
  session(3, '07'),
  session(4, '08', { finished: false }),
];
const rom = [...openPoints(1, '01', 0.6), ...openPoints(2, '05', 0.5)];

describe('latest session with open-pose data', () => {
  it('skips a fist-only session and an unfinished one in the hand map, with a note', () => {
    const hand = handFromOverview(undefined, history, rom);
    GLOVE_FINGERS.forEach((f) => {
      expect(hand.first[f]?.own).toBeCloseTo(0.4);
      expect(hand.last[f]?.own).toBeCloseTo(0.5);
    });
    expect(hand.assistDirection).toBe('open');
    const picked = rangeSessions(history, rom);
    expect(picked.measured.map((s) => s.id)).toEqual([1, 2]);
    expect(picked.note).toBe(
      'Latest session had no measured open-hand attempts; showing the session from Nov 5, 2026.',
    );
  });
  it('adds no note when only an unfinished session is newer', () => {
    const picked = rangeSessions(
      history.filter((s) => s.id !== 3),
      rom,
    );
    expect(picked.measured.at(-1)?.id).toBe(2);
    expect(picked.note).toBeUndefined();
  });
  it('keeps a measured session whole: a finger it missed stays a gap', () => {
    const partial = [
      ...openPoints(1, '01', 0.6),
      ...openPoints(2, '05', 0.5, ['thumb', 'index', 'middle']),
    ];
    const hand = handFromOverview(undefined, history, partial);
    expect(hand.last.thumb?.own).toBeCloseTo(0.5);
    expect(hand.last.pinky?.own).toBeNull();
  });
  it('picks the same session for the latest effort bars, never borrowing fingers', () => {
    const partial = [
      ...openPoints(1, '01', 0.6),
      ...openPoints(2, '05', 0.5, ['thumb', 'index', 'middle']),
    ];
    const assist = [
      ...assistPoints(1, '01', 0.3),
      ...assistPoints(2, '05', 0.2),
    ];
    const latest = latestEffort(
      GLOVE_FINGERS.map((finger) => ({
        finger,
        rows: effortSeries(partial, assist, finger, history),
      })),
      history,
    );
    expect(latest.session?.sessionId).toBe(2);
    expect(latest.note).toBe(
      'Latest session had no measured open-hand attempts; showing the session from Nov 5, 2026.',
    );
    const row = (f: GloveFinger) =>
      latest.rows.find((r) => r.finger === f)!.row;
    expect(row('thumb')).toMatchObject({ sessionId: 2, glove: 0.2 });
    expect(row('thumb')?.own).toBeCloseTo(0.5);
    expect(row('pinky')).toMatchObject({ sessionId: 2, own: null });
  });
  it('shows nothing rather than an empty latest session when no session has data', () => {
    const latest = latestEffort(
      GLOVE_FINGERS.map((finger) => ({
        finger,
        rows: effortSeries([], [], finger, history),
      })),
      history,
    );
    expect(latest.session).toBeUndefined();
    expect(rangeSessions(history, []).measured).toEqual([]);
  });
});

describe('headline margins', () => {
  it('keeps the margins in one place and compares whole, displayed values', () => {
    expect(RANGE_MARGIN_POINTS).toBe(5);
    expect(RESISTANCE_MARGIN_MA).toBe(5);
    expect(meaningful(55, 50, 5)).toBe(1);
    expect(meaningful(54, 50, 5)).toBe(0);
    expect(meaningful(45, 50, 5)).toBe(-1);
    // 47.68% vs 47.62%: both show as 48%.
    expect(compareRange(0.4768, 0.4762)).toBe(0);
    expect(compareRange(0.53, 0.48)).toBe(1);
    expect(compareResistance(0.48, 0)).toBe(0);
    expect(compareResistance(-0.4, 0)).toBe(0);
    expect(compareResistance(45, 40)).toBe(1);
  });
  it('names a finger only when it clearly did the most', () => {
    const own = (values: Partial<Record<GloveFinger, number | null>>) =>
      GLOVE_FINGERS.map((finger) => ({
        finger,
        row: { own: values[finger] ?? null },
      }));
    // The QA case: every finger shows 48%, pinky ahead by 0.07 points.
    expect(
      latestEffortTitle(
        own({
          thumb: 0.4761,
          index: 0.4762,
          middle: 0.4759,
          ring: 0.476,
          pinky: 0.4768,
        }),
      ),
    ).toBe('Fingers did about the same on their own last time');
    expect(latestEffortTitle(own({ index: 0.52, pinky: 0.48 }))).toBe(
      'Fingers did about the same on their own last time',
    );
    expect(latestEffortTitle(own({ index: 0.53, pinky: 0.48 }))).toBe(
      'Index did the most on its own last time',
    );
    expect(latestEffortTitle(own({ index: 0.53 }))).toBe('Latest session');
  });
  it('calls small effort and trend changes steady', () => {
    const rows = effortSeries(
      [
        ...openPoints(1, '01', 0.52, ['index']),
        ...openPoints(2, '05', 0.5, ['index']),
      ],
      [],
      'index',
    );
    expect(effortTakeaway(rows, 'index')).toBe(
      'Index: about the same, 50% on your own',
    );
    const trend = (a: number, b: number) =>
      trendTakeaway(
        [
          { x: 1, demo: false, active: a },
          { x: 2, demo: false, active: b },
        ],
        true,
      );
    expect(trend(52, 49)).toBe('your movement over time');
    expect(trend(52, 47)).toBe('opening further on your own');
  });
});

describe('resistance takeaways', () => {
  const point = (
    evaluation_id: number,
    day: string,
    finger: GloveFinger,
    slow: number | null,
    fast: number | null,
  ): ResistancePoint => ({
    evaluation_id,
    started_at: at(day),
    finger,
    slow,
    fast,
    dependence: slow != null && fast != null ? fast - slow : null,
    is_demo: false,
    assist_direction: 'open',
  });
  it('describes one evaluation by fast against slow, with the margin', () => {
    // The QA case: +0 mA (0.48 mA) is not "more resistance".
    expect(
      resistanceTakeaway(dumbbellRows([point(1, '01', 'thumb', -0.28, 0.2)])),
    ).toBe('Fast and slow sweeps met about the same resistance');
    expect(
      resistanceTakeaway(dumbbellRows([point(1, '01', 'thumb', 50, 90)])),
    ).toBe('Fast sweeps met more resistance than slow ones');
    expect(
      resistanceTakeaway(dumbbellRows([point(1, '01', 'thumb', 90, 50)])),
    ).toBe('Slow sweeps met more resistance than fast ones');
  });
  it('does not call a −0.4 mA change "eased"', () => {
    const rows = dumbbellRows([
      point(1, '01', 'middle', -0.18, -0.08),
      point(2, '05', 'middle', -0.04, -0.36),
    ]);
    expect(resistanceTakeaway(rows)).toBe(
      'Speed-dependent resistance stayed about the same',
    );
  });
  it('names a single compared finger and ignores stopped or empty sweeps', () => {
    const points = [
      point(1, '01', 'thumb', 60, 100),
      point(2, '05', 'thumb', 60, 80),
      // Evaluation 3 stopped safely on the thumb; evaluation 4 skipped it.
      point(3, '07', 'thumb', 60, 140),
      point(4, '08', 'index', 70, null),
    ];
    const evaluations = [
      {
        id: 3,
        fingers: [
          {
            finger: 'thumb' as const,
            resistance_slow_ma: 60,
            resistance_fast_ma: 140,
            velocity_dependence_ma: 80,
            peak_excess_ma: 600,
            aborted: true,
          },
        ],
      },
    ];
    const rows = dumbbellRows(points, evaluations);
    expect(rows.thumb.map((r) => r.stopped)).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect(resistanceTakeaway(rows)).toBe(
      'Speed-dependent resistance eased on the thumb',
    );
    // Without the flag, the partial sweep would turn the change into a rise.
    expect(resistanceTakeaway(dumbbellRows(points))).toBe(
      'Speed-dependent resistance rose on the thumb',
    );
    const compact = compactDumbbellRows(rows, 4);
    expect(compact.thumb.map((r) => r.evaluationId)).toEqual([1, 2]);
    // Index has only a slow sweep (evaluation 4): shown, never compared.
    expect(compact.index.map((r) => r.evaluationId)).toEqual([4]);
    expect(resistanceTakeaway(compact)).toBe(
      'Speed-dependent resistance eased on the thumb',
    );
  });
  it('separates eased on some fingers from uneven changes', () => {
    const rows = dumbbellRows([
      point(1, '01', 'thumb', 60, 100),
      point(1, '01', 'index', 60, 100),
      point(2, '05', 'thumb', 60, 80),
      point(2, '05', 'index', 60, 102),
    ]);
    expect(resistanceTakeaway(rows)).toBe(
      'Speed-dependent resistance eased on some fingers',
    );
    const uneven = dumbbellRows([
      point(1, '01', 'thumb', 60, 100),
      point(1, '01', 'index', 60, 100),
      point(2, '05', 'thumb', 60, 80),
      point(2, '05', 'index', 60, 130),
    ]);
    expect(resistanceTakeaway(uneven)).toBe(
      'Speed-dependent resistance changed unevenly across fingers',
    );
  });
});
