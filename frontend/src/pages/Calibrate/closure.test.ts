import { describe, expect, it } from 'vitest';
import { MAX_ASSIST_PULL } from '../../contracts/poses';
import type { Quint } from '../../contracts/glove';
import { CalibrationOpening } from './closure';
import { freshDraft } from './draft';

describe('five-finger camera calibration', () => {
  it('uses the five-servo normal limit', () => {
    expect(freshDraft().limit).toBe(1500);
  });
  it('starts 150 ms apart, holds unscheduled fingers and caps movement at three', () => {
    const position: Quint = [0, 0, 0, 0, 0];
    const closure = new CalibrationOpening(position);
    expect(closure.advance(0, position)).toBe(true);
    expect(closure.target).toEqual([MAX_ASSIST_PULL, 0, 0, 0, 0]);
    expect(closure.advance(149, position)).toBe(false);
    expect(closure.advance(150, position)).toBe(true);
    expect(closure.advance(300, position)).toBe(true);
    expect(closure.advance(450, position)).toBe(false);
    expect(closure.settled(position)).toBe(false);
    position[0] = MAX_ASSIST_PULL;
    expect(closure.advance(500, position)).toBe(true);
    expect(closure.target).toEqual([
      MAX_ASSIST_PULL,
      MAX_ASSIST_PULL,
      MAX_ASSIST_PULL,
      MAX_ASSIST_PULL,
      0,
    ]);
    position[1] = MAX_ASSIST_PULL;
    expect(closure.advance(650, position)).toBe(true);
    expect(closure.target).toEqual([
      MAX_ASSIST_PULL,
      MAX_ASSIST_PULL,
      MAX_ASSIST_PULL,
      MAX_ASSIST_PULL,
      MAX_ASSIST_PULL,
    ]);
    expect(closure.settled(position)).toBe(false);
    expect(
      closure.settled([
        MAX_ASSIST_PULL,
        MAX_ASSIST_PULL,
        MAX_ASSIST_PULL,
        MAX_ASSIST_PULL,
        MAX_ASSIST_PULL,
      ]),
    ).toBe(true);
  });
  it('preserves the initial position of every waiting finger', () => {
    const position: Quint = [0.4, 0.2, 0.5, 0.1, 0.3];
    const closure = new CalibrationOpening(position);
    closure.advance(0, position);
    expect(closure.target).toEqual([MAX_ASSIST_PULL, 0.2, 0.5, 0.1, 0.3]);
    expect(position).toEqual([0.4, 0.2, 0.5, 0.1, 0.3]);
  });
});
