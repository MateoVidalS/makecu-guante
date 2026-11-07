import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { AttemptResult, SessionSummary } from '../../contracts/engine';
import {
  AttemptFeedback,
  AttemptStrip,
  FingerGauge,
  HandGlyph,
  SpeedDumbbell,
  SplitBars,
  SweepTracker,
  ThenNow,
  WeekStrip,
  attemptFills,
  attemptSentence,
  fingerDeltas,
  goalShare,
  lastSevenDays,
  recapSentence,
  stifferAtSpeed,
  streak,
} from './index';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const finger = (
  f: 'thumb' | 'index' | 'middle' | 'ring' | 'pinky',
  target: number | null,
  active_max: number | null,
  final: number | null = active_max,
) => ({
  finger: f,
  scored: target != null,
  target,
  active_max,
  assist_needed:
    target != null && active_max != null
      ? Math.max(0, target - active_max)
      : null,
  final,
});
function attempt(over: Partial<AttemptResult> = {}): AttemptResult {
  return {
    pose: 'full_fist',
    rep: 1,
    index: 0,
    started_at: '2026-11-05T10:00:00Z',
    ended_at: '2026-11-05T10:00:10Z',
    reached_active: false,
    reached_final: true,
    assisted: true,
    time_to_position_s: null,
    active_ratio: 0.5,
    fingers: [
      finger('thumb', 0.6, 0.3, 0.6),
      finger('index', 0.8, 0.8, 0.8),
      finger('middle', null, 0.2),
    ],
    pinch_min: null,
    current_peak_ma: 200,
    current_mean_ma: 150,
    safety_events: [],
    interrupted: false,
    trace: {
      hz: 20,
      t: [],
      closure: { thumb: [], index: [], middle: [], ring: [], pinky: [] },
      servo: { thumb: [], index: [], middle: [], ring: [], pinky: [] },
      ma: [],
      phase: [],
    },
    ...over,
  };
}
const summary = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  attempts: 15,
  reached_active: 9,
  assisted: 6,
  interrupted: 0,
  active_ratio_mean: 0.6,
  per_pose: [],
  per_finger: [
    { finger: 'thumb', active_max_mean: 0.38, assist_needed_mean: 0.2 },
    { finger: 'index', active_max_mean: 0.55, assist_needed_mean: 0.1 },
    { finger: 'middle', active_max_mean: null, assist_needed_mean: null },
  ],
  previous: {
    active_ratio_mean: 0.5,
    per_finger: [
      { finger: 'thumb', active_max_mean: 0.35 },
      { finger: 'index', active_max_mean: 0.4 },
      { finger: 'middle', active_max_mean: 0.6 },
    ],
  },
  ...over,
});

describe('metric math', () => {
  it('scores closing and opening goals like the engine', () => {
    expect(goalShare(0.3, 0.6)).toBeCloseTo(0.5);
    expect(goalShare(0.9, 0.6)).toBe(1);
    expect(goalShare(0.2, 0)).toBeCloseTo(0.8);
    expect(goalShare(null, 0.6)).toBeNull();
    expect(goalShare(0.4, null)).toBeNull();
  });
  it('splits each finger into own effort and glove help', () => {
    const fills = attemptFills(attempt());
    expect(fills.thumb!.own).toBeCloseTo(0.5);
    expect(fills.thumb!.help).toBeCloseTo(0.5);
    expect(fills.index).toEqual({ own: 1, help: 0 });
    expect(fills.middle).toBeNull();
  });
  it('writes one honest, effort-framed sentence', () => {
    expect(attemptSentence(attempt())).toBe(
      'Good effort. The glove helped with the rest.',
    );
    expect(
      attemptSentence(attempt({ reached_active: true, assisted: false })),
    ).toBe('You did that on your own.');
    expect(attemptSentence(attempt({ interrupted: true }))).toMatch(/paused/);
    for (const s of [attemptSentence(attempt()), recapSentence(summary())])
      expect(s).not.toMatch(/fail|miss|error/i);
  });
  it('compares fingers with the previous session and keeps gaps as gaps', () => {
    const d = fingerDeltas(
      summary().per_finger,
      summary().previous!.per_finger,
    );
    expect(d.map((x) => x.delta)).toEqual([3, 15, null, null, null]);
    expect(recapSentence(summary())).toBe(
      'Your index closed further on its own than last time.',
    );
    expect(
      recapSentence(summary({ previous: null, reached_active: 2 })),
    ).toMatch(/Good effort/);
  });
  it('flags stiffness only for a clear jump at speed', () => {
    expect(stifferAtSpeed(60, 70)).toBe(false);
    expect(stifferAtSpeed(60, 110)).toBe(true);
    expect(stifferAtSpeed(null, 110)).toBe(false);
  });
  it('builds the last seven local days and a calm streak', () => {
    const now = new Date(2026, 10, 7, 12);
    const days = lastSevenDays(
      [
        new Date(2026, 10, 6, 9).toISOString(),
        new Date(2026, 10, 5, 9).toISOString(),
        new Date(2026, 10, 1, 9).toISOString(),
        new Date(2026, 9, 1, 9).toISOString(),
      ],
      now,
    );
    expect(days).toHaveLength(7);
    expect(days[6].today).toBe(true);
    expect(days.filter((d) => d.practiced)).toHaveLength(3);
    expect(streak(days)).toBe(2);
  });
});

describe('metric components', () => {
  it('live gauge is a meter with goal, best-on-your-own and glove part', () => {
    render(
      <FingerGauge
        finger="index"
        value={0.65}
        best={0.4}
        target={0.8}
        state="assist"
      />,
    );
    const meter = screen.getByRole('meter', { name: 'Index' });
    expect(meter).toHaveAttribute('aria-valuenow', '0.65');
    expect(meter).toHaveAttribute(
      'aria-valuetext',
      '65%, goal 80%, best on your own 40%, glove helping',
    );
    expect(meter.querySelector('.mx-gauge__band')).not.toBeNull();
    expect(meter.querySelector('.mx-gauge__best')).toHaveStyle({
      bottom: '40%',
    });
    expect(meter.querySelector('.mx-fill--help')).toHaveStyle({
      bottom: '40%',
      height: '25%',
    });
    expect(screen.getByText('Glove helping')).toBeVisible();
  });
  it('retains the helped part when a finger reaches during assistance', () => {
    render(
      <FingerGauge
        finger="ring"
        value={0.95}
        best={0.4}
        target={0.95}
        state="reached"
        assisting
      />,
    );
    expect(screen.getByRole('meter').closest('.mx-gauge')).toHaveAttribute(
      'data-state',
      'reached',
    );
    expect(
      screen.getByRole('meter').querySelector('.mx-fill--help'),
    ).not.toBeNull();
  });
  it('gauge shows a gap, not 0, when the hand is not seen; free fingers have no goal', () => {
    render(
      <>
        <FingerGauge
          finger="thumb"
          value={null}
          best={null}
          target={0.5}
          state="active"
        />
        <FingerGauge
          finger="middle"
          value={0.2}
          best={null}
          target={null}
          state="active"
        />
      </>,
    );
    expect(screen.getByText('—')).toBeVisible();
    expect(screen.getByText('Not seen')).toBeVisible();
    expect(screen.getByText('Free')).toBeVisible();
    expect(
      screen
        .getByRole('meter', { name: 'Middle' })
        .querySelector('.mx-gauge__band'),
    ).toBeNull();
  });
  it('attempt feedback shows a labelled hand and one sentence, then hides', () => {
    vi.useFakeTimers();
    const { container } = render(<AttemptFeedback result={attempt()} />);
    expect(container.querySelector('.attempt-toast')).not.toBeNull();
    expect(
      screen.getByRole('img', {
        name: /Thumb 50% of the way on your own, glove helped 50%/,
      }),
    ).toBeVisible();
    expect(
      screen.getByText('Good effort. The glove helped with the rest.'),
    ).toBeVisible();
    expect(screen.queryByText(/\d+% on your own ·/)).toBeNull();
    act(() => vi.advanceTimersByTime(4000));
    expect(container.querySelector('.attempt-toast')).toBeNull();
  });
  it('hand glyph fills only the glove fingers', () => {
    const { container } = render(
      <HandGlyph
        label="Hand"
        fills={{
          thumb: { own: 0.5, help: 0.25 },
          index: null,
          ring: { own: 0.3, help: 0.2 },
          pinky: { own: 0.7, help: 0 },
        }}
      />,
    );
    expect(container.querySelectorAll('.mx-fill--own')).toHaveLength(3);
    expect(container.querySelectorAll('.mx-fill--help')).toHaveLength(2);
    expect(container.querySelectorAll('.mx-hand__idle')).toHaveLength(2);
  });
  it('attempt strip groups by pose and names every outcome', () => {
    render(
      <AttemptStrip
        attempts={[
          { group: 'Hook', outcome: 'own' },
          { group: 'Hook', outcome: 'helped' },
          { group: 'Pinch', outcome: 'paused' },
        ]}
      />,
    );
    expect(screen.getByRole('list', { name: 'Hook' })).toBeVisible();
    expect(screen.getByText('Attempt 2: Reached with the glove')).toBeTruthy();
    expect(screen.getByText('Attempt 3: Paused')).toBeTruthy();
    expect(document.querySelectorAll('.mx-strip .mx-dot--helped')).toHaveLength(
      2,
    );
  });
  it('split bars stack own effort and glove help per finger', () => {
    render(
      <SplitBars
        rows={[
          { finger: 'thumb', own: 0.38, help: 0.2 },
          { finger: 'middle', own: null, help: null },
        ]}
      />,
    );
    expect(
      screen.getByRole('img', {
        name: 'Thumb: 38% on your own, glove helped 20% more',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('img', { name: 'Middle: No reading' }),
    ).toBeVisible();
  });
  it('then-now draws two hands with ▲/▼ deltas, never color alone', () => {
    const deltas = fingerDeltas(summary().per_finger, [
      { finger: 'thumb', active_max_mean: 0.4 },
      { finger: 'index', active_max_mean: 0.4 },
      { finger: 'middle', active_max_mean: 0.6 },
    ]);
    render(<ThenNow deltas={deltas} />);
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.getByText('(better)', { exact: false })).toBeTruthy();
    expect(screen.getByText('(lower)', { exact: false })).toBeTruthy();
  });
  it('week strip counts days against the goal', () => {
    const days = lastSevenDays([new Date().toISOString()], new Date());
    render(<WeekStrip days={days} />);
    expect(screen.getByText('1 of 5 days')).toBeVisible();
    expect(
      screen.getByRole('list', { name: 'Practice in the last 7 days' })
        .children,
    ).toHaveLength(7);
  });
  it('dumbbell labels slow and fast and calls out stiffness at speed', () => {
    render(
      <SpeedDumbbell
        rows={[
          { finger: 'thumb', slow: 60, fast: 120 },
          {
            finger: 'index',
            slow: 70,
            fast: null,
            aborted: true,
            abortedAt: 0.3,
          },
        ]}
      />,
    );
    expect(screen.getByText('Stiffer at speed')).toBeVisible();
    expect(
      screen.getByRole('img', {
        name: 'Thumb: slow 60 mA, fast 120 mA, stiffer at speed',
      }),
    ).toBeVisible();
    expect(screen.getByText('Stopped safely')).toBeVisible();
  });
  it('sweep tracker marks done, current and next steps', () => {
    render(
      <SweepTracker
        fingers={['thumb', 'index', 'middle']}
        finger="index"
        speed="slow"
        progress={0.5}
      />,
    );
    const steps = screen.getAllByRole('listitem');
    expect(steps.map((s) => s.dataset.state)).toEqual([
      'done',
      'done',
      'now',
      'next',
      'next',
      'next',
    ]);
  });
});
