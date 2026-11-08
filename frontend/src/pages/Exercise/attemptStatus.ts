import type { AttemptResult, ExercisePhase } from '../../contracts/engine';
import type { GloveFinger } from '../../contracts/glove';
import {
  resistanceStop,
  stopPlace,
  type ResistanceStop,
} from '../../components/metrics/stop';

/** A resistance stop during attempt `index` (06-session §3 Resistance row). */
export interface LiveStop extends ResistanceStop {
  index: number;
}

/**
 * The engine freezes the glove when a finger resists, then lets the attempt run on
 * (ASSIST_HOLD with what it achieved, RELEASE, REST). Until the result arrives in REST,
 * the stop is what the patient needs to see, not "Hold it".
 */
const STOP_PHASES: ExercisePhase[] = [
  'ATTEMPT',
  'ASSIST',
  'ASSIST_HOLD',
  'RELEASE',
];

/** The stop to show now: only in the attempt it happened in, until its result arrives. */
export function liveStop(
  stop: LiveStop | null,
  phase: ExercisePhase,
  index: number,
): LiveStop | null {
  return stop && stop.index === index && STOP_PHASES.includes(phase)
    ? stop
    : null;
}

/** How one finger relates to a live stop, for its colour on the hand and gauges. */
export function stopFor(
  stop: ResistanceStop | null,
  finger: GloveFinger,
): 'self' | 'other' | null {
  return stop ? (stop.finger === finger ? 'self' : 'other') : null;
}

/** `caution`: the glove stopped for resistance, amber because the stop is the system working. */
export type AttemptStatusTone = 'reached' | 'assist' | 'neutral' | 'caution';
export interface AttemptStatus {
  title: string;
  tone: AttemptStatusTone;
  /** Show a check mark: the pose was reached. */
  done: boolean;
  /** A short label for the phase ring when the title is a sentence. */
  label?: string;
  /** The line under the headline, instead of the pose instruction. */
  hint?: string;
}

/**
 * What the patient should know right now about this attempt: reached and holding, or how
 * the attempt ended. Null while there is nothing to report (keep showing the instruction).
 * `result` must be this attempt's result (it arrives when RELEASE ends, i.e. during REST).
 * `stop` is the latest resistance stop (`useResistanceStop`); it shows only during its own
 * attempt, until the result (which records it) arrives.
 */
export function attemptStatus(
  phase: ExercisePhase,
  result: AttemptResult | null,
  index: number,
  stop: LiveStop | null = null,
): AttemptStatus | null {
  // The glove stopped for resistance (the voice says so): say it on screen too, with no
  // "Hold it" countdown for help that stopped. 11-ux §6.3 safety copy, shortened to fit
  // one display line; amber, not red: the stop is the system working.
  const live = liveStop(stop, phase, index);
  if (live)
    return {
      title: `Stopped — resistance in your ${stopPlace(live)}`,
      tone: 'caution',
      done: false,
      label: 'Glove stopped',
      hint: 'The glove stopped pulling. Relax your hand.',
    };
  // Reached on your own. (After the glove's help the pose may or may not have been
  // reached, so ASSIST_HOLD only says "Hold it"; the rest then tells the outcome.)
  if (phase === 'HOLD')
    return { title: 'Got it! Hold it', tone: 'reached', done: true };
  if (phase === 'ASSIST_HOLD')
    return { title: 'Hold it', tone: 'assist', done: false };
  // The 0.5 s release before the result: match the ring instead of flashing back to
  // the pose instruction.
  if (phase === 'RELEASE')
    return { title: 'Relax your hand', tone: 'neutral', done: false };
  if (phase !== 'REST' || !result || result.index !== index) return null;
  if (result.interrupted)
    return { title: 'Attempt paused', tone: 'neutral', done: false };
  const stopped = resistanceStop(result);
  if (stopped)
    return {
      title: `We stopped to keep your ${stopPlace(stopped)} safe`,
      tone: 'caution',
      done: false,
      label: 'Rest a moment',
    };
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
