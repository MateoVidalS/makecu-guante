import { CURRENT_CAMERA_VIEW, type CameraView } from '../contracts/calibration';
import { VISION_LOW_CONFIDENCE, type Handedness } from '../contracts/vision';

export interface HandCategory {
  categoryName: string;
  score: number;
}

/** A lone hand that MediaPipe labels as the other hand with at least this
 * handedness score is not published. On the real recordings, 97% of such
 * labels on bystanders' hands and the patient's free hand reach it, and the
 * patient's own hand reached it in 1 of 294 lone-hand frames. The rendered
 * bench hand shows 0.90-0.94 on the patient's hand in a single-finger pose,
 * for up to 7 frames at 30 Hz, so lower scores keep the configured hand.
 * Evidence: README.md, "Hand identity".
 */
export const OTHER_HAND_MIN_SCORE = 0.95;

/** The top MediaPipe category as a subject hand: `handedness` is null for an
 * unknown label. Null when the score is missing or below the 0.6 gate.
 * MediaPipe Tasks receives unmirrored video, and its labels name the
 * subject's hand. `mirror` inverts them for cameras that deliver mirrored frames.
 */
function topLabel(
  categories: HandCategory[],
  mirror: boolean,
): { handedness: Handedness | null; score: number } | null {
  const category = [...categories].sort((a, b) => b.score - a.score)[0];
  if (
    !category ||
    !Number.isFinite(category.score) ||
    category.score < VISION_LOW_CONFIDENCE
  )
    return null;
  const label = category.categoryName.toLowerCase();
  const reported = label === 'left' || label === 'right' ? label : null;
  return {
    handedness:
      reported && mirror ? (reported === 'left' ? 'right' : 'left') : reported,
    score: Math.min(1, category.score),
  };
}

/** True when the only visible hand is confidently labelled as the other hand
 * (see `OTHER_HAND_MIN_SCORE`). `selectHand` drops such a hand.
 */
export function isOtherHand(
  hands: HandCategory[][],
  affected: Handedness,
  mirror = false,
): boolean {
  if (hands.length !== 1) return false;
  const top = topLabel(hands[0], mirror);
  return (
    top !== null &&
    top.handedness !== null &&
    top.handedness !== affected &&
    top.score >= OTHER_HAND_MIN_SCORE
  );
}

/** Picks the configured affected hand, in both camera views.
 * - Two hands: the labels select the configured hand.
 * - One hand: it is published as the configured hand, unless MediaPipe
 *   confidently labels it as the other hand (`isOtherHand`). A missing frame is
 *   safer than another person's hand or the patient's free hand. An unknown
 *   or unsure label keeps the configured hand. The label never flips the
 *   configured hand or the geometry.
 * - In `front_upright`, `mismatch` reports a published lone hand whose label
 *   disagrees with the configured hand.
 * CSS preview mirroring is independent of `mirror`.
 */
export function selectHand(
  hands: HandCategory[][],
  affected: Handedness,
  mirror = false,
  view: CameraView = CURRENT_CAMERA_VIEW,
): {
  index: number;
  handedness: Handedness;
  score: number;
  mismatch: boolean | null;
} | null {
  if (isOtherHand(hands, affected, mirror)) return null;
  const candidates = hands
    .map((categories, index) => {
      const top = topLabel(categories, mirror);
      if (!top) return null;
      if (hands.length === 1)
        return {
          index,
          handedness: affected,
          score: top.score,
          mismatch:
            view === 'front_upright' && top.handedness !== null
              ? top.handedness !== affected
              : null,
        };
      if (!top.handedness) return null;
      return {
        index,
        handedness: top.handedness,
        score: top.score,
        mismatch: view === 'front_upright' ? top.handedness !== affected : null,
      };
    })
    .filter((candidate) => candidate !== null);
  return (
    candidates
      .filter((c) => c.handedness === affected)
      .sort((a, b) => b.score - a.score)[0] ?? null
  );
}

/** Internal presence fades over 200ms. Published undetected frames use confidence=0 per the contract. */
export class ConfidenceTracker {
  private seen: number | null = null;
  private score = 0;
  update(score: number | null, time: number): number {
    if (
      score !== null &&
      Number.isFinite(score) &&
      score >= VISION_LOW_CONFIDENCE
    ) {
      this.seen = time;
      this.score = Math.min(1, score);
    }
    return this.value(time);
  }
  value(time: number): number {
    return this.seen === null
      ? 0
      : this.score * Math.max(0, Math.min(1, 1 - (time - this.seen) / 200));
  }
  reset() {
    this.seen = null;
    this.score = 0;
  }
}
