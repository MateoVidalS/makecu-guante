import type { AttemptResult } from '../../contracts/engine';
import type { GloveFinger } from '../../contracts/glove';

/** The glove stopped helping because a finger resisted (06-session §3 Resistance row). */
export interface ResistanceStop {
  /** The finger that resisted; null when the engine could not tell which one. */
  finger: GloveFinger | null;
}

/**
 * Whether the glove stopped this attempt for resistance, and on which finger. The engine
 * records it as a `resistance` safety event (once per attempt) and lets the attempt end
 * normally, so `assisted` alone would wrongly say the glove helped.
 */
export function resistanceStop(
  result: Pick<AttemptResult, 'safety_events'>,
): ResistanceStop | null {
  const event = result.safety_events?.find((e) => e.source === 'resistance');
  return event ? { finger: event.finger } : null;
}

/** "index", or "hand" when the finger is unknown: for sentences like "your index". */
export const stopPlace = (stop: ResistanceStop) => stop.finger ?? 'hand';
