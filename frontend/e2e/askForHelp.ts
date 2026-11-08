import type { RehabRuntime } from '../src/runtime/runtime';
import type { SimWorld } from '../src/glove/sim';

/**
 * The glove moves only when the patient asks. Simulated patients in these harnesses ask
 * as soon as help is offered, so assist mechanics are tested through the real request path.
 */
export function askForHelpWhenOffered(runtime: RehabRuntime, world: SimWorld) {
  return world.ticks.subscribe(() => {
    if (runtime.exercise.view().helpOffered) runtime.exercise.requestHelp();
  });
}
