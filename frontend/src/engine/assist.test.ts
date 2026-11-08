import { describe, expect, it } from 'vitest';
import { GLOVE_FINGERS, type Quint } from '../contracts/glove';
import { POSES } from '../contracts/poses';
import { AssistScheduler } from './assist';

const zeros = (): Quint => [0, 0, 0, 0, 0];

describe('power-aware assist scheduler', () => {
  it.each([1, 2, 3])(
    'never moves more than %i servos, with starts at least 150 ms apart',
    (parallel) => {
      const scheduler = new AssistScheduler(POSES.open, zeros(), 150, parallel);
      const position = zeros();
      const starts: { at: number; finger: number }[] = [];
      let peak = 0;
      for (let now = 0; now <= 20000; now += 5) {
        const prior = [...scheduler.target];
        scheduler.advance(
          now,
          position,
          [1, 1, 1, 1, 1],
          [true, true, true, true, true],
        );
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
        'thumb',
        'index',
        'middle',
        'ring',
        'pinky',
      ]);
      for (let i = 1; i < starts.length; i++)
        expect(starts[i].at - starts[i - 1].at).toBeGreaterThanOrEqual(150);
      expect(position).toEqual(scheduler.goal);
      expect(
        scheduler.complete(
          position,
          [1, 1, 1, 1, 1],
          [true, true, true, true, true],
        ),
      ).toBe(true);
    },
  );

  it('keeps stalled servos in their slots and does not catch up missed starts on clock jumps', () => {
    const scheduler = new AssistScheduler(POSES.open, zeros(), 150, 3);
    for (const now of [0, 1000, 1000, 2000, 3000, 10000])
      scheduler.advance(
        now,
        zeros(),
        [1, 1, 1, 1, 1],
        [true, true, true, true, true],
      );
    expect(scheduler.target).toEqual([0.95, 0.95, 0.95, 0, 0]);
    expect(
      scheduler.complete(
        zeros(),
        [1, 1, 1, 1, 1],
        [true, true, true, true, true],
      ),
    ).toBe(false);
  });

  it('orders by opening deficit and refreshes held fingers without raising their pull', () => {
    const position: Quint = [0.2, 0.2, 0.2, 0.2, 0.2];
    const scheduler = new AssistScheduler(POSES.hook, position, 150, 3);
    const vision: Quint = [0.9, 0.6, 0.8, 0.95, 0.9];
    const assistable = [false, false, true, true, true];
    scheduler.refreshHeld(position, vision);
    scheduler.advance(0, position, vision, assistable);
    expect(scheduler.target[3]).toBeCloseTo(0.4);
    for (const i of [0, 1, 2, 4])
      expect(scheduler.target[i]).toBeLessThanOrEqual(position[i]);
    scheduler.refreshHeld(position, [1, 0.6, 0.8, 0.95, 0.9]);
    expect(scheduler.target[0]).toBe(0);
    scheduler.advance(150, position, [1, 0.6, 1, 0.95, 0.9], assistable);
    expect(scheduler.target[2]).toBeCloseTo(0.4);
  });

  it('caps pull and never raises a target for a closing deficit', () => {
    const scheduler = new AssistScheduler(POSES.open, zeros(), 150, 3);
    expect(scheduler.goal).toEqual([0.95, 0.95, 0.95, 0.95, 0.95]);
    const closing = new AssistScheduler(POSES.full_fist, zeros(), 150, 3);
    expect(
      closing.advance(0, zeros(), zeros(), [false, false, false, false, false]),
    ).toBe(false);
    expect(closing.target).toEqual(zeros());
  });
});

it('sheds in reverse start order down to the held pull, waiting for actual payout before the next finger', () => {
  const scheduler = new AssistScheduler(POSES.open, zeros(), 150, 3);
  const vision: Quint = [1, 1, 1, 1, 1];
  const eligible = [true, true, true, true, true];
  scheduler.advance(0, zeros(), vision, eligible);
  scheduler.advance(150, zeros(), vision, eligible);
  for (let i = 0; i < 19; i++)
    expect(scheduler.shedLoad(zeros(), vision)).toBe(1);
  expect(scheduler.target[1]).toBeCloseTo(0);
  expect(scheduler.shedLoad([0, 0.5, 0, 0, 0], vision)).toBeNull();
  expect(scheduler.shedLoad(zeros(), vision)).toBe(0);
  scheduler.refreshHeld(zeros(), vision);
  scheduler.advance(1000, zeros(), vision, eligible);
  expect(scheduler.target[1]).toBeCloseTo(0);
});

it('allows settlement within 0.02 pull without requiring exact endpoint telemetry', () => {
  const scheduler = new AssistScheduler(POSES.open, zeros(), 150, 3);
  const position = zeros();
  const eligible = [true, true, true, true, true];
  for (let i = 0; i < 5; i++) {
    scheduler.advance(i * 150, position, [1, 1, 1, 1, 1], eligible);
    for (let j = 0; j < 5; j++) position[j] = scheduler.target[j];
  }
  expect(
    scheduler.complete(
      position.map((v) => v - 0.01) as Quint,
      [1, 1, 1, 1, 1],
      eligible,
    ),
  ).toBe(true);
  expect(
    scheduler.complete(
      position.map((v) => v - 0.03) as Quint,
      [1, 1, 1, 1, 1],
      eligible,
    ),
  ).toBe(false);
});
