import { useEffect, useState } from 'react';
import type { Runtime } from '../../contracts/runtime';
import { useRuntime } from '../../runtime';
import type { LiveStop } from './attemptStatus';

/** Remembers the engine's `resistance` event with its attempt index. */
export function watchResistance(
  exercise: Pick<Runtime['exercise'], 'onEvent' | 'view'>,
  set: (stop: LiveStop | null) => void,
) {
  return exercise.onEvent((event) => {
    if (event.kind === 'resistance')
      set({ index: exercise.view().index, finger: event.finger });
    // A new attempt starts clean; a safety pause has its own banner and words.
    else if (
      event.kind === 'phase' &&
      (event.phase === 'PRESENT' || event.phase === 'PAUSED')
    )
      set(null);
  });
}

/**
 * The latest resistance stop of this session (pass it to `attemptStatus`/`liveStop`).
 * `ExerciseView` (a contract) has no field for it, so it comes from the runtime's
 * `resistance` engine event, the same one the safety voice speaks from.
 */
export function useResistanceStop(): LiveStop | null {
  const runtime = useRuntime();
  const [stop, setStop] = useState<LiveStop | null>(null);
  useEffect(() => watchResistance(runtime.exercise, setStop), [runtime]);
  return stop;
}
