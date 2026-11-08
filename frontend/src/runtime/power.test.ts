import { beforeEach, expect, it } from 'vitest';
import { DEFAULT_EXERCISE_SETTINGS } from '../contracts/poses';
import {
  oneMotorAtATime,
  powerAwareSettings,
  setOneMotorAtATime,
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
