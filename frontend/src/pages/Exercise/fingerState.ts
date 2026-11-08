import type { ExercisePhase } from '../../contracts/engine';
import { DEFAULT_EXERCISE_SETTINGS } from '../../contracts/poses';
import type { FingerState } from '../../hand3d/scene';

/** One state per finger: free fingers and missing tracking stay quiet. */
export function liveFingerState({
  phase,
  target,
  value,
  best,
  assisting,
  tolerance = DEFAULT_EXERCISE_SETTINGS.tolerance,
}: {
  phase: ExercisePhase;
  target: number | null;
  value: number | null;
  best: number | null;
  assisting: boolean;
  tolerance?: number;
}): FingerState {
  if (
    target === null ||
    value === null ||
    !['ATTEMPT', 'HOLD', 'ASSIST', 'ASSIST_HOLD'].includes(phase)
  )
    return 'idle';
  const reached = (v: number) =>
    target <= 0.05 ? v <= target + tolerance : v >= target - tolerance;
  if (reached(value)) return 'reached';
  if (
    assisting &&
    value > target + tolerance &&
    (best === null || best > target + tolerance)
  )
    return 'assist';
  return 'active';
}
