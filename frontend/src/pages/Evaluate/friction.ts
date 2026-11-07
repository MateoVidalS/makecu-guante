import type { Calibration } from '../../contracts/calibration';
import { GLOVE_FINGERS } from '../../contracts/glove';
import { DEFAULT_EVAL_SETTINGS } from '../../contracts/poses';

// Friction is specific to the current glove setup. Recheck at least daily.
const MAX_FRICTION_AGE_MS = 24 * 60 * 60 * 1000;
export function hasCompleteFriction(friction: Calibration['friction']) {
  return GLOVE_FINGERS.every((finger) =>
    [DEFAULT_EVAL_SETTINGS.slow_v, DEFAULT_EVAL_SETTINGS.fast_v].every(
      (speed) =>
        friction[finger]?.some(
          (curve) =>
            curve.v === speed &&
            curve.points.length >= 2 &&
            curve.points.every(
              (p) => Number.isFinite(p.pos) && Number.isFinite(p.ma),
            ) &&
            Math.min(...curve.points.map((p) => p.pos)) <= 0.2 &&
            Math.max(...curve.points.map((p) => p.pos)) >= 0.9,
        ),
    ),
  );
}
export function hasRecentFriction(
  calibration: Calibration | null,
  now = Date.now(),
) {
  if (!calibration) return false;
  const age = now - Date.parse(calibration.created_at);
  return (
    age >= 0 &&
    age < MAX_FRICTION_AGE_MS &&
    hasCompleteFriction(calibration.friction)
  );
}
