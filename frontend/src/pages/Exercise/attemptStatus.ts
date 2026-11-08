import type { AttemptResult, ExercisePhase } from '../../contracts/engine';

export type AttemptStatusTone = 'reached' | 'assist' | 'neutral';
export interface AttemptStatus {
  title: string;
  tone: AttemptStatusTone;
  /** Show a check mark: the pose was reached. */
  done: boolean;
}

/**
 * What the patient should know right now about this attempt: reached and holding, or how
 * the attempt ended. Null while there is nothing to report (keep showing the instruction).
 * `result` must be this attempt's result (it arrives when RELEASE ends, i.e. during REST).
 */
export function attemptStatus(
  phase: ExercisePhase,
  result: AttemptResult | null,
  index: number,
): AttemptStatus | null {
  // Reached on your own. (After the glove's help the pose may or may not have been
  // reached, so ASSIST_HOLD only says "Hold it"; the rest then tells the outcome.)
  if (phase === 'HOLD')
    return { title: 'Got it! Hold it', tone: 'reached', done: true };
  if (phase === 'ASSIST_HOLD')
    return { title: 'Hold it', tone: 'assist', done: false };
  if (phase !== 'REST' || !result || result.index !== index) return null;
  if (result.interrupted)
    return { title: 'Attempt paused', tone: 'neutral', done: false };
  if (result.reached_active)
    return { title: 'You did it on your own!', tone: 'reached', done: true };
  if (result.assisted && result.reached_final)
    return {
      title: "Done, with the glove's help",
      tone: 'assist',
      done: true,
    };
  if (result.assisted)
    return {
      title: 'The glove helped. Good effort',
      tone: 'assist',
      done: false,
    };
  return { title: 'Not this time. Good effort', tone: 'neutral', done: false };
}
