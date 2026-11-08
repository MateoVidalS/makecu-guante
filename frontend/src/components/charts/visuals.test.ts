import { describe, expect, it } from 'vitest';
import overview from '../../../../contracts/fixtures/history_overview.json';
import rom from '../../../../contracts/fixtures/history_rom.json';
import assist from '../../../../contracts/fixtures/history_assist.json';
import resistance from '../../../../contracts/fixtures/history_resistance.json';
import sessions from '../../../../contracts/fixtures/sessions.json';
import type {
  AssistPoint,
  Evaluation,
  HistoryOverview,
  ResistancePoint,
  RomPoint,
  Session,
} from '../../contracts/api';
import type { FingerAttemptMetrics } from '../../contracts/engine';
import evaluations from '../../../../contracts/fixtures/evaluations.json';
import {
  attemptLevel,
  calendarTakeaway,
  compareWithPrevious,
  dumbbellDomain,
  dumbbellRows,
  effortSeries,
  effortTakeaway,
  handFromAttempt,
  handFromOverview,
  phaseSegments,
  practiceCalendar,
  resistanceTakeaway,
} from './visuals';

describe('evaluation comparison', () => {
  it('keeps this evaluation and only the one right before it', () => {
    const latest = (evaluations as Evaluation[]).find((e) => e.id === 3)!;
    const points = compareWithPrevious(latest, resistance as ResistancePoint[]);
    expect([...new Set(points.map((p) => p.evaluation_id))]).toEqual([2, 3]);
    expect(points.filter((p) => p.evaluation_id === 3)).toHaveLength(5);
    const first = (evaluations as Evaluation[]).find((e) => e.id === 1)!;
    expect(
      new Set(
        compareWithPrevious(first, resistance as ResistancePoint[]).map(
          (p) => p.evaluation_id,
        ),
      ),
    ).toEqual(new Set([1]));
  });
});

describe('hand map values', () => {
  it('reads first and latest from the overview', () => {
    const { first, last } = handFromOverview(overview as HistoryOverview);
    expect(first.thumb?.own).toBe(0.35);
    expect(last.middle?.own).toBe(0.67);
    expect(handFromOverview(undefined)).toEqual({ first: {}, last: {} });
  });
  it('compares the actual first and latest session, not the first measured ring/pinky values', () => {
    const history = structuredClone(sessions) as Session[];
    const first = history.reduce((a, b) =>
      a.started_at < b.started_at ? a : b,
    );
    first.summary!.per_finger = first.summary!.per_finger.filter(
      (f) => f.finger !== 'ring' && f.finger !== 'pinky',
    );
    const hand = handFromOverview(overview as HistoryOverview, history);
    expect(hand.first.ring).toBeUndefined();
    expect(hand.first.pinky).toBeUndefined();
    expect(hand.last.ring?.own).toBeTypeOf('number');
    expect(hand.last.pinky?.own).toBeTypeOf('number');
  });
  it('keeps scored glove fingers and caps the glove part at 100%', () => {
    const fingers: FingerAttemptMetrics[] = [
      {
        finger: 'thumb',
        scored: true,
        target: 0.7,
        active_max: 0.63,
        assist_needed: 0.07,
        final: 0.7,
      },
      {
        finger: 'index',
        scored: true,
        target: 1,
        active_max: 0.8,
        assist_needed: 0.4,
        final: 1,
      },
      {
        finger: 'middle',
        scored: false,
        target: 1,
        active_max: null,
        assist_needed: null,
        final: null,
      },
      {
        finger: 'ring',
        scored: true,
        target: 1,
        active_max: 0.5,
        assist_needed: 0.5,
        final: 1,
      },
    ];
    const hand = handFromAttempt(fingers);
    expect(Object.keys(hand)).toEqual(['thumb', 'index', 'ring']);
    expect(hand.thumb).toEqual({ own: 0.63, glove: 0.07, target: 0.7 });
    expect(hand.index?.glove).toBeCloseTo(0.2);
  });
});

describe('effort series', () => {
  it('joins active range and glove help per session, oldest first', () => {
    const rows = effortSeries(
      rom as RomPoint[],
      assist as AssistPoint[],
      'thumb',
    );
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({
      sessionId: 1,
      own: 0.35,
      glove: 0.65,
      demo: true,
    });
    expect(rows.at(-1)).toMatchObject({ sessionId: 8, own: 0.63 });
    rows.forEach((r) =>
      expect((r.own ?? 0) + (r.glove ?? 0)).toBeLessThanOrEqual(1 + 1e-9),
    );
    expect(effortTakeaway(rows, 'thumb')).toBe('Thumb: 35% → 63% on your own');
  });
  it('aligns ring and pinky to legacy and unmeasured sessions without borrowing older values', () => {
    const points = rom as RomPoint[];
    const legacyId = points[0].session_id;
    for (const finger of ['ring', 'pinky'] as const) {
      const mixed = points.filter(
        (p) => p.session_id !== legacyId || p.finger !== finger,
      );
      const timeline = [
        { id: 99, started_at: '2027-01-01T00:00:00Z', is_demo: false },
      ];
      const rows = effortSeries(mixed, [], finger, timeline);
      expect(rows[0]).toMatchObject({
        sessionId: legacyId,
        own: null,
        glove: null,
      });
      expect(rows[1].own).toBeTypeOf('number');
      expect(rows.at(-1)).toMatchObject({
        sessionId: 99,
        own: null,
        glove: null,
      });
    }
  });
  it('keeps sessions with only one measurement as gaps, not zeros', () => {
    const rows = effortSeries(
      [],
      [
        {
          session_id: 3,
          started_at: '2026-10-01T00:00:00Z',
          finger: 'index',
          assist_needed_mean: 0.4,
          assisted_rate: 1,
          is_demo: false,
        },
      ],
      'index',
    );
    expect(rows[0].own).toBeNull();
    expect(rows[0].glove).toBe(0.4);
    expect(effortTakeaway(rows, 'index')).toBe('Index: not measured');
  });
});

describe('practice calendar', () => {
  it('builds Monday-first weeks up to today and counts recent days', () => {
    const cal = practiceCalendar(sessions, new Date('2026-11-07T12:00:00Z'));
    expect(cal.weeks).toHaveLength(8);
    cal.weeks.forEach((w) => expect(w).toHaveLength(7));
    expect(new Date(cal.weeks[0][0].date).getUTCDay()).toBe(1);
    const flat = cal.weeks.flat();
    expect(flat.find((d) => d.date === '2026-11-05')).toMatchObject({
      attempts: 1,
      sessions: 1,
      demo: false,
    });
    expect(flat.find((d) => d.date === '2026-10-15')?.demo).toBe(true);
    expect(flat.find((d) => d.date === '2026-11-08')?.future).toBe(true);
    expect(cal.last7).toBe(2);
    expect(cal.last28).toBe(8);
    expect(calendarTakeaway(cal.last7, cal.last28)).toBe(
      'Practiced 2 of the last 7 days, 8 of the last 28',
    );
    expect(calendarTakeaway(0, 0)).toBe('No practice in the last 4 weeks');
  });
  it('grows to cover older practice but stops at the max', () => {
    const old = [
      { started_at: '2025-01-01T00:00:00Z', n_attempts: 3, is_demo: false },
    ];
    expect(
      practiceCalendar(old, new Date('2026-11-07T00:00:00Z')).weeks,
    ).toHaveLength(26);
    expect(
      practiceCalendar([], new Date('2026-11-07T00:00:00Z')).weeks,
    ).toHaveLength(8);
  });
  it('bins attempts into five levels', () => {
    expect([0, 1, 3, 7, 20].map(attemptLevel)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('resistance dumbbells', () => {
  it('groups by finger, oldest first, with a shared rounded domain', () => {
    const rows = dumbbellRows(resistance as ResistancePoint[]);
    expect(rows.thumb.map((r) => r.gap)).toEqual([110, 90, 70]);
    expect(dumbbellDomain(Object.values(rows).flat())).toEqual([50, 350]);
    expect(resistanceTakeaway(rows)).toBe(
      'Speed-dependent resistance eased on every finger',
    );
    expect(resistanceTakeaway(rows, Date.parse('2026-10-16T00:00:00Z'))).toBe(
      'Fast sweeps met more resistance than slow ones',
    );
  });
  it('keeps all five fingers for mixed and subset evaluations', () => {
    const legacy = (resistance as ResistancePoint[]).filter(
      (p) => p.finger !== 'ring' && p.finger !== 'pinky',
    );
    const rows = dumbbellRows(legacy);
    expect(rows.ring).toHaveLength(3);
    expect(rows.pinky).toHaveLength(3);
    rows.ring.forEach((r) =>
      expect(r).toMatchObject({ slow: null, fast: null, gap: null }),
    );
    expect(resistanceTakeaway(rows)).toBe(
      'Speed-dependent resistance eased on measured fingers',
    );
    expect(dumbbellDomain(Object.values(rows).flat())).toEqual([50, 350]);
  });
  it('fills the gap from slow and fast when dependence is missing', () => {
    const rows = dumbbellRows([
      {
        evaluation_id: 1,
        started_at: '2026-10-01T00:00:00Z',
        finger: 'index',
        slow: 100,
        fast: 160,
        dependence: null,
        is_demo: false,
      },
      {
        evaluation_id: 2,
        started_at: '2026-10-09T00:00:00Z',
        finger: 'index',
        slow: 100,
        fast: null,
        dependence: null,
        is_demo: false,
      },
    ]);
    expect(rows.index.map((r) => r.gap)).toEqual([60, null]);
    expect(
      resistanceTakeaway({
        thumb: [],
        index: [],
        middle: [],
        ring: [],
        pinky: [],
      }),
    ).toBe('No resistance measured yet');
  });
});

describe('phase segments', () => {
  it('labels contiguous phases and drops empty ones', () => {
    const segs = phaseSegments({
      t: [0, 1, 2, 3, 4],
      phase: ['ATTEMPT', 'ATTEMPT', 'ASSIST', 'ASSIST_HOLD', 'RELEASE'],
    });
    expect(segs.map((s) => [s.kind, s.start, s.end])).toEqual([
      ['active', 0, 2],
      ['assist', 2, 3],
      ['assistHold', 3, 4],
    ]);
    expect(phaseSegments(undefined)).toEqual([]);
  });
});

it('does not compare opening and closing cohorts in hand maps or resistance changes', () => {
  const history = structuredClone(sessions) as Session[];
  const newest = history.reduce((a, b) =>
    a.started_at > b.started_at ? a : b,
  );
  newest.assist_direction = 'open';
  const points = [
    {
      session_id: newest.id,
      started_at: newest.started_at,
      finger: 'thumb' as const,
      pose: 'open' as const,
      active_max_mean: 0.3,
      is_demo: false,
      assist_direction: 'open' as const,
    },
  ];
  const hand = handFromOverview(undefined, history, points);
  expect(hand.first.thumb?.own).toBeCloseTo(0.7);
  expect(hand.last.thumb?.own).toBeCloseTo(0.7);
  expect(hand.assistDirection).toBe('open');
  const current = {
    ...(evaluations as Evaluation[]).reduce((a, b) =>
      a.started_at > b.started_at ? a : b,
    ),
    assist_direction: 'open' as const,
  };
  expect(
    compareWithPrevious(current, resistance as ResistancePoint[]).every(
      (p) => p.evaluation_id === current.id && p.assist_direction === 'open',
    ),
  ).toBe(true);
  const mixed = (resistance as ResistancePoint[]).map((p) => ({
    ...p,
    assist_direction:
      p.evaluation_id === current.id ? ('open' as const) : ('close' as const),
  }));
  expect(resistanceTakeaway(dumbbellRows(mixed))).toBe(
    'Fast sweeps met more resistance than slow ones',
  );
});

it('shows camera closure as active opening in effort and attempt hand maps', () => {
  const point = {
    session_id: 1,
    started_at: '2026-11-01',
    finger: 'index' as const,
    pose: 'open' as const,
    active_max_mean: 0.7,
    is_demo: false,
    assist_direction: 'open' as const,
  };
  expect(effortSeries([point], [], 'index')[0].own).toBeCloseTo(0.3);
  const hand = handFromAttempt(
    [
      {
        finger: 'index',
        scored: true,
        target: 0,
        active_max: 0.7,
        assist_needed: 0.7,
        final: 0.1,
      },
    ],
    'open',
  );
  expect(hand.index?.own).toBeCloseTo(0.3);
  expect(hand.index?.glove).toBeCloseTo(0.7);
  expect(hand.index?.target).toBe(1);
});
