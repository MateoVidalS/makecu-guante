import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_EXERCISE_SETTINGS } from '../contracts/poses';
import {
  FollowShaper,
  oneMotorAtATime,
  powerAwareSettings,
  setOneMotorAtATime,
  StagedRelease,
} from './power';

beforeEach(() => localStorage.clear());

it('is on by default and remembers the choice', () => {
  expect(oneMotorAtATime()).toBe(true);
  setOneMotorAtATime(false);
  expect(oneMotorAtATime()).toBe(false);
  setOneMotorAtATime(true);
  expect(oneMotorAtATime()).toBe(true);
});

it('helps one finger at a time on a real glove, with time for every finger', () => {
  const s = powerAwareSettings(DEFAULT_EXERCISE_SETTINGS, true, true);
  expect(s.assist_max_parallel).toBe(1);
  expect(s.assist_max_s).toBe(DEFAULT_EXERCISE_SETTINGS.assist_max_s * 3);
  // Never faster or stronger: speed, tolerance and everything else are unchanged.
  expect({ ...s, assist_max_parallel: undefined, assist_max_s: 0 }).toEqual({
    ...DEFAULT_EXERCISE_SETTINGS,
    assist_max_parallel: undefined,
    assist_max_s: 0,
  });
});

it('leaves the simulator and a full supply unchanged', () => {
  expect(powerAwareSettings(DEFAULT_EXERCISE_SETTINGS, false, true)).toBe(
    DEFAULT_EXERCISE_SETTINGS,
  );
  expect(powerAwareSettings(DEFAULT_EXERCISE_SETTINGS, true, false)).toBe(
    DEFAULT_EXERCISE_SETTINGS,
  );
});

describe('low-power follow', () => {
  const tel = (a: number[]) => ({ a });
  it('winds one finger at a time, the one that wants the most first', () => {
    const s = new FollowShaper();
    // The hand opens: every finger wants slack taken up at once.
    expect(s.shape([0.5, 0.9, 0.6, 0.6, 0.6], tel([0, 0, 0, 0, 0]))).toEqual([
      0, 0.9, 0, 0, 0,
    ]);
    // The index is still winding toward 0.82: nobody else starts.
    expect(s.shape([0.5, 0.9, 0.6, 0.6, 0.6], tel([0, 0.4, 0, 0, 0]))).toEqual([
      0, 0.9, 0, 0, 0,
    ]);
    // The index arrived: the next largest gain (middle, first of the ties) goes.
    expect(s.shape([0.5, 0.9, 0.6, 0.6, 0.6], tel([0, 0.82, 0, 0, 0]))).toEqual(
      [0, 0.9, 0.6, 0, 0],
    );
  });
  it('always pays out at once, on every finger, even while one winds', () => {
    const s = new FollowShaper();
    s.shape([0.9, 0, 0, 0, 0], tel([0, 0, 0, 0, 0]));
    // Patient closes fast while the thumb is still winding: thumb pays out immediately.
    expect(s.shape([0.1, 0, 0, 0, 0], tel([0.3, 0, 0, 0, 0]))).toEqual([
      0.1, 0, 0, 0, 0,
    ]);
  });
  it('starts over after a release', () => {
    const s = new FollowShaper();
    s.shape([0.9, 0, 0, 0, 0], tel([0, 0, 0, 0, 0]));
    s.reset();
    expect(s.shape([0.4, 0.5, 0, 0, 0], tel([0, 0, 0, 0, 0]))).toEqual([
      0, 0.5, 0, 0, 0,
    ]);
  });
});

describe('low-power staged release', () => {
  const run = (a: number[]) => ({ a, st: 'run' });
  it('unwinds the most-pulled finger first, one at a time, then releases', () => {
    const r = new StagedRelease();
    expect(r.start([0.95, 0.95, 0.7, 0.95, 0.4])).toEqual([
      0, 0.95, 0.7, 0.95, 0.4,
    ]);
    // The thumb is still unwinding: wait.
    expect(r.step(run([0.5, 0.95, 0.7, 0.95, 0.4]))).toBeNull();
    // Thumb slack: the next most-pulled (index) goes; nobody winds.
    expect(r.step(run([0, 0.95, 0.7, 0.95, 0.4]))).toEqual([
      0, 0, 0.7, 0.95, 0.4,
    ]);
    expect(r.step(run([0, 0, 0.7, 0.95, 0.4]))).toEqual([0, 0, 0.7, 0, 0.4]);
    expect(r.step(run([0, 0, 0.7, 0, 0.4]))).toEqual([0, 0, 0, 0, 0.4]);
    expect(r.step(run([0, 0, 0, 0, 0.4]))).toEqual([0, 0, 0, 0, 0]);
    expect(r.step(run([0, 0, 0, 0, 0]))).toBe('release');
    expect(r.active()).toBe(false);
  });
  it('never sends anything once the board left run mode (brake, pause, fault)', () => {
    const r = new StagedRelease();
    r.start([0.9, 0.9, 0, 0, 0]);
    expect(r.step({ a: [0.5, 0.9, 0, 0, 0], st: 'idle' })).toBeNull();
    expect(r.active()).toBe(false);
    expect(r.step(run([0, 0.9, 0, 0, 0]))).toBeNull();
  });
  it('a slack glove releases normally', () => {
    expect(new StagedRelease().start([0, 0.01, 0, 0, 0])).toBeNull();
  });
});
