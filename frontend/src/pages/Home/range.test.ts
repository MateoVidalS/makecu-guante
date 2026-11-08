import { describe, expect, it } from 'vitest';
import type { Session } from '../../contracts/api';
import { rangeComparison } from './range';

const session = (id: number, day: string, thumb: number | null): Session =>
  ({
    id,
    started_at: `2026-11-${day}T10:00:00Z`,
    summary: {
      per_finger: [
        { finger: 'thumb', active_max_mean: thumb, assist_needed_mean: 0 },
        { finger: 'index', active_max_mean: 0.5, assist_needed_mean: 0 },
        { finger: 'middle', active_max_mean: 0.5, assist_needed_mean: 0 },
      ],
      previous: null,
    },
  }) as unknown as Session;

describe('home active range', () => {
  it('compares the latest session with one at least a week older', () => {
    const r = rangeComparison([
      session(1, '01', 0.3),
      session(2, '05', 0.35),
      session(3, '09', 0.45),
    ])!;
    expect(r.latest.id).toBe(3);
    expect(r.thenLabel).toBe('A week before');
    expect(r.deltas[0].delta).toBe(15);
    expect(r.changeText).toBe(
      'Your thumb closes further on its own than a week before.',
    );
  });
  it('falls back to the session before, and to nothing without history', () => {
    const r = rangeComparison([session(1, '05', 0.4), session(2, '06', 0.41)])!;
    expect(r.thenLabel).toBe('Time before');
    expect(r.changeText).toMatch(/About the same/);
    expect(rangeComparison([])).toBeNull();
    expect(rangeComparison([session(1, '05', 0.4)])!.changeText).toMatch(
      /first range/,
    );
  });
});

it('compares open poses within one direction and ignores directionless previous summaries', () => {
  const legacy = session(1, '01', 0.99);
  const first = { ...session(2, '05', 0.9), assist_direction: 'open' as const };
  const latest = {
    ...session(3, '09', 0.8),
    assist_direction: 'open' as const,
  };
  const opening = [first, latest].map((s, i) => ({
    session_id: s.id,
    started_at: s.started_at,
    finger: 'thumb' as const,
    pose: 'open' as const,
    active_max_mean: i ? 0.3 : 0.6,
    is_demo: false,
    assist_direction: 'open' as const,
  }));
  const result = rangeComparison([legacy, first, latest], opening)!;
  expect(result.thenLabel).toBe('Time before');
  expect(result.deltas[0]).toMatchObject({ then: 0.4, now: 0.7, delta: 30 });
  expect(result.changeText).toContain('opens further');
  expect(
    rangeComparison([legacy, latest], opening)!.deltas[0].delta,
  ).toBeNull();
});

describe('a session without open-hand attempts', () => {
  const open = (id: number, day: string, finished = true) => ({
    ...session(id, day, null),
    assist_direction: 'open' as const,
    summary: finished ? session(id, day, null).summary : null,
  });
  const points = (id: number, day: string, closure: number) =>
    (['thumb', 'index', 'middle', 'ring', 'pinky'] as const).map((finger) => ({
      session_id: id,
      started_at: `2026-11-${day}T10:00:00Z`,
      finger,
      pose: 'open' as const,
      active_max_mean: closure,
      is_demo: false,
      assist_direction: 'open' as const,
    }));
  const rom = [...points(1, '01', 0.7), ...points(2, '06', 0.5)];

  it('compares the latest measured sessions instead of claiming a first range', () => {
    // Session 3 practiced only fists; session 4 never finished (0 attempts).
    const r = rangeComparison(
      [open(1, '01'), open(2, '06'), open(3, '07'), open(4, '08', false)],
      rom,
    )!;
    expect(r.latest.id).toBe(2);
    expect(r.deltas.every((d) => d.now != null)).toBe(true);
    expect(r.deltas[0]).toMatchObject({ delta: 20 });
    expect(r.changeText).toBe(
      'Your thumb opens further on its own than the time before.',
    );
    expect(r.note).toBe(
      'Latest session had no measured open-hand attempts; showing the session from Nov 6, 2026.',
    );
  });
  it('says "first range" only when one session truly has data', () => {
    const r = rangeComparison(
      [open(1, '01'), open(2, '06'), open(3, '07')],
      points(2, '06', 0.5),
    )!;
    expect(r.latest.id).toBe(2);
    expect(r.changeText).toMatch(/first range/);
    expect(rangeComparison([open(3, '07')], [])).toBeNull();
  });
  it('calls a change under the margin steady', () => {
    const r = rangeComparison(
      [open(1, '01'), open(2, '06')],
      [...points(1, '01', 0.52), ...points(2, '06', 0.48)],
    )!;
    expect(r.deltas[0].delta).toBe(4);
    expect(r.changeText).toBe('About the same as the time before. Steady.');
    expect(r.note).toBeUndefined();
  });
});
