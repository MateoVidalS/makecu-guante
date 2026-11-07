import type { AttemptResult, SessionSummary } from '../contracts/engine';
import { GLOVE_FINGERS } from '../contracts/glove';
import type { ExerciseView } from '../contracts/runtime';
import { fingerName } from './fingerNames';

export const pct = (value: number | null | undefined): string =>
  value == null ? 'not measured' : `${Math.round(value * 100)}%`;

export function targetUnmet(
  active: number | null | undefined,
  target: number | null,
): boolean {
  if (active == null || target === null) return false;
  // Opening is scored by the minimum closure, so less closure is better.
  return target === 0 ? active > 0 : active < target;
}

export function movementContext(view: ExerciseView): string {
  const fingers = GLOVE_FINGERS.filter((f) =>
    targetUnmet(view.activeMax[f], view.pose.closure[f]),
  );
  return (
    fingers
      .map(
        (f) =>
          `${fingerName(f)} ${pct(view.activeMax[f])}/${pct(view.pose.closure[f])}`,
      )
      .join('; ') || 'no measured fingers short of target'
  );
}

export function attemptContext(
  result: AttemptResult,
  previous?: AttemptResult | null,
): string {
  const relevant = result.fingers.filter(
    (f) =>
      f.scored &&
      f.target !== null &&
      (targetUnmet(f.active_max, f.target) || (f.assist_needed ?? 0) > 0),
  );
  const details = relevant
    .map((f) => {
      const prior =
        previous?.pose === result.pose
          ? previous.fingers.find(
              (p) => p.finger === f.finger && p.scored && p.target === f.target,
            )
          : undefined;
      return (
        `${fingerName(f.finger)} active ${pct(f.active_max)}/${pct(f.target)}, help needed ${pct(f.assist_needed)}` +
        (prior?.active_max != null
          ? ` (previous ${pct(prior.active_max)})`
          : '')
      );
    })
    .join('; ');
  return (
    `active effort ${pct(result.active_ratio)}; reached ${result.reached_final ? 'yes' : 'no'}; glove assisted ${result.assisted ? 'yes' : 'no'}; interrupted ${result.interrupted ? 'yes' : 'no'}. ` +
    `Fingers below target or needing help: ${details || 'none measured'}. Previous rep: ${previous?.pose === result.pose ? 'included where comparable' : 'unavailable'}.`
  );
}

export function summaryContext(summary: SessionSummary | null): string {
  if (!summary) return 'unavailable';
  const details = summary.per_finger
    .filter((f) => (f.assist_needed_mean ?? 0) > 0)
    .map((f) => {
      const prior = summary.previous?.per_finger.find(
        (p) => p.finger === f.finger,
      );
      return (
        `${fingerName(f.finger)} active ${pct(f.active_max_mean)}, mean help needed ${pct(f.assist_needed_mean)}` +
        (prior?.active_max_mean != null
          ? ` (previous active ${pct(prior.active_max_mean)})`
          : '')
      );
    })
    .join('; ');
  return (
    `${summary.attempts} attempts, ${summary.reached_active} reached alone, ${summary.assisted} assisted, ${summary.interrupted} interrupted; active effort ${pct(summary.active_ratio_mean)}. ` +
    `Fingers needing help: ${details || 'none measured'}. Previous active effort: ${pct(summary.previous?.active_ratio_mean)}.`
  );
}

/** One compact, non-speaking snapshot; unknown measurements remain null. */
export function liveContext(
  state: import('../contracts/therapist').LiveTherapyState,
): string {
  return (
    '[live] ' +
    JSON.stringify({
      phase: state.phase,
      pose: state.pose,
      rep: state.rep,
      index: state.index,
      total: state.total,
      seconds_in_phase: Math.round(state.seconds_in_phase),
      fingers: state.fingers.map((f) => ({
        ...f,
        now: f.now === null ? null : Math.round(f.now * 100),
        target: f.target === null ? null : Math.round(f.target * 100),
        best_alone:
          f.best_alone === null ? null : Math.round(f.best_alone * 100),
      })),
      units: 'finger values are percentages',
      last_attempt: state.last_attempt,
      adjustments: state.adjustments,
      last_feeling: state.last_feeling,
    })
  );
}
