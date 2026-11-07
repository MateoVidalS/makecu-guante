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
