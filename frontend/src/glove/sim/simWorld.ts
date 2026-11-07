import { StubGlove } from '../StubGlove';
import { StubVision } from '../../vision/StubVision';
import type { PoseId } from '../../contracts/poses';
import type { ExercisePhase } from '../../contracts/engine';
export class SimWorld {
  readonly glove = new StubGlove();
  readonly vision = new StubVision();
  setIntent(_pose: PoseId, _phase: ExercisePhase) {
    /* WP2 patient model */
  }
  stop() {
    void this.glove.disconnect();
    this.vision.stop();
  }
}
export const createSimWorld = () => new SimWorld();
