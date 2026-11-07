import type { FingerId, JointAngles } from '../contracts/vision';
import { FINGERS, fingerMap } from './flex';
import { OneEuroFilter } from './oneEuro';

/**
 * One Euro tuning for joint angles in degrees. MediaPipe world landmarks jitter
 * by a few millimetres, which is several degrees on a short phalanx. A low
 * minimum cutoff removes that tremor; beta (per deg/s) opens the filter for a
 * real movement so a full fist still lands within ~200 ms.
 */
export const JOINT_FILTER = { minCutoff: 0.3, beta: 0.01, dCutoff: 1 };

const create = () =>
  new OneEuroFilter(
    JOINT_FILTER.minCutoff,
    JOINT_FILTER.beta,
    JOINT_FILTER.dCutoff,
  );

/** Smooths every joint angle independently on the camera timeline. */
export class JointFilter {
  private filters = fingerMap(() => [create(), create(), create()] as const);
  filter(
    joints: Record<FingerId, JointAngles>,
    t: number,
  ): Record<FingerId, JointAngles> {
    return fingerMap((finger) => {
      const [mcp, pip, dip] = this.filters[finger];
      const raw = joints[finger];
      return {
        mcp: mcp.filter(raw.mcp, t),
        pip: pip.filter(raw.pip, t),
        // The thumb has no DIP; keep it exactly zero.
        dip: finger === 'thumb' ? 0 : dip.filter(raw.dip, t),
      };
    });
  }
  reset() {
    for (const finger of FINGERS)
      for (const filter of this.filters[finger]) filter.reset();
  }
}
