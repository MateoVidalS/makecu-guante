import type { EvaluationEngine } from './types';
export function createEvaluationEngine(): EvaluationEngine {
  const pending = (): never => {
    throw new Error('WP4');
  };
  return { start: pending, tick: pending, stop: pending, state: pending };
}
export function frictionRun(): never {
  throw new Error('WP4');
}
