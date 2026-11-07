import type { ExerciseEngine } from './types';
export function createExerciseEngine(): ExerciseEngine {
  const pending = (): never => {
    throw new Error('WP4');
  };
  return {
    start: pending,
    tick: pending,
    pause: pending,
    resume: pending,
    skip: pending,
    stop: pending,
    state: pending,
  };
}
