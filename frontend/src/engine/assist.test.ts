import { describe, expect, it } from 'vitest';
import { GLOVE_FINGERS, type Quint } from '../contracts/glove';
import { POSES } from '../contracts/poses';
import { AssistScheduler } from './assist';

const zeros = (): Quint => [0, 0, 0, 0, 0];

describe('power-aware assist scheduler', () => {
  it.each([1, 2, 3])(
    'never moves more than %i servos, with starts at least 150 ms apart',
    (parallel) => {
      const scheduler = new AssistScheduler(
        POSES.full_fist,
        zeros(),
        150,
        parallel,
      );
      const position = zeros();
      const starts: { at: number; finger: number }[] = [];
      let peak = 0;
      for (let now = 0; now <= 20000; now += 5) {
        const prior = [...scheduler.target];
        scheduler.advance(now, position, zeros(), [
          true,
          true,
          true,
          true,
          true,
        ]);
        scheduler.target.forEach((v, i) => {
          if (v !== prior[i]) starts.push({ at: now, finger: i });
        });
        const moving = position.filter(
          (v, i) => Math.abs(v - scheduler.target[i]) > 1e-6,
        ).length;
        peak = Math.max(peak, moving);
        expect(moving).toBeLessThanOrEqual(parallel);
        position.forEach((v, i) => {
          const gap = scheduler.target[i] - v;
          position[i] += Math.sign(gap) * Math.min(Math.abs(gap), 0.3 * 0.005);
        });
      }
      expect(peak).toBe(parallel);
      expect(starts.map((s) => GLOVE_FINGERS[s.finger])).toEqual([
        'index',
        'middle',
        'ring',
        'pinky',
        'thumb',
      ]);
      for (let i = 1; i < starts.length; i++)
        expect(starts[i].at - starts[i - 1].at).toBeGreaterThanOrEqual(150);
      expect(position).toEqual(scheduler.goal);
      expect(
        scheduler.complete(position, zeros(), [true, true, true, true, true]),
      ).toBe(true);
    },
  );

  it('keeps stalled servos in their slots and does not catch up missed starts on clock jumps', () => {
    const scheduler = new AssistScheduler(POSES.full_fist, zeros(), 150, 3);
    for (const now of [0, 1000, 1000, 2000, 3000, 10000])
      scheduler.advance(now, zeros(), zeros(), [true, true, true, true, true]);
    expect(scheduler.target).toEqual([0, 0.95, 0.95, 0.95, 0]);
    expect(
      scheduler.complete(zeros(), zeros(), [true, true, true, true, true]),
    ).toBe(false);
  });

  it('uses fresh vision gaps to order queued fingers and holds free/reached fingers still', () => {
    const position: Quint = [0.2, 0.2, 0.2, 0.2, 0.2];
    const scheduler = new AssistScheduler(POSES.hook, position, 150, 3);
    scheduler.advance(
      0,
      position,
      [0.2, 0.5, 0.3, 0, 0.1],
      [false, false, true, true, true],
    );
    expect(scheduler.target).toEqual([0.2, 0.2, 0.2, 0.6, 0.2]);
    scheduler.advance(
      150,
      position,
      [0.2, 0.5, 0, 0, 0.3],
      [false, false, true, true, true],
    );
    expect(scheduler.target).toEqual([0.2, 0.2, 0.6, 0.6, 0.2]);
  });

  it('caps closing targets and schedules opening in order of largest gap', () => {
    const aboveRange = {
      ...POSES.full_fist,
      closure: { thumb: 1, index: 1, middle: 1, ring: 1, pinky: 1 },
    };
    const scheduler = new AssistScheduler(aboveRange, zeros(), 150, 3);
    expect(scheduler.goal).toEqual([0.95, 0.95, 0.95, 0.95, 0.95]);
    const opening = new AssistScheduler(
      POSES.open,
      [0.2, 0.3, 0.4, 0.5, 0.8],
      150,
      3,
    );
    opening.advance(
      0,
      [0.2, 0.3, 0.4, 0.5, 0.8],
      [0.2, 0.3, 0.4, 0.5, 0.8],
      [true, true, true, true, true],
    );
    expect(opening.target).toEqual([0.2, 0.3, 0.4, 0.5, 0]);
  });
});
