import { describe, expect, it } from 'vitest';
import type { Quint } from '../../contracts/glove';
import { CalibrationClosure } from './closure';
import { freshDraft } from './draft';

describe('five-finger camera calibration', () => {
  it('uses the five-servo normal limit', () => {
    expect(freshDraft().limit).toBe(1500);
  });
  it('starts 150 ms apart, holds unscheduled fingers and caps movement at three', () => {
    const position: Quint = [0, 0, 0, 0, 0];
    const closure = new CalibrationClosure(position);
    expect(closure.advance(0, position)).toBe(true);
    expect(closure.target).toEqual([1, 0, 0, 0, 0]);
    expect(closure.advance(149, position)).toBe(false);
    expect(closure.advance(150, position)).toBe(true);
    expect(closure.advance(300, position)).toBe(true);
    expect(closure.advance(450, position)).toBe(false);
    expect(closure.settled(position)).toBe(false);
    position[0] = 1;
    expect(closure.advance(500, position)).toBe(true);
    expect(closure.target).toEqual([1, 1, 1, 1, 0]);
    position[1] = 1;
    expect(closure.advance(650, position)).toBe(true);
    expect(closure.target).toEqual([1, 1, 1, 1, 1]);
    expect(closure.settled(position)).toBe(false);
    expect(closure.settled([1, 1, 1, 1, 1])).toBe(true);
  });
  it('preserves the initial position of every waiting finger', () => {
    const position: Quint = [0.4, 0.2, 0.5, 0.1, 0.3];
    const closure = new CalibrationClosure(position);
    closure.advance(0, position);
    expect(closure.target).toEqual([1, 0.2, 0.5, 0.1, 0.3]);
    expect(position).toEqual([0.4, 0.2, 0.5, 0.1, 0.3]);
  });
});
