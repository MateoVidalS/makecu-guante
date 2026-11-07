import { VISION_LOW_CONFIDENCE, type Handedness } from '../contracts/vision';

export interface HandCategory {
  categoryName: string;
  score: number;
}
/** Mirror changes labels only, not geometry or the preview. Never borrow the other hand when two are visible. */
export function selectHand(
  hands: HandCategory[][],
  affected: Handedness,
  mirror = false,
): { index: number; handedness: Handedness; score: number } | null {
  const candidates = hands
    .map((categories, index) => {
      const category = [...categories].sort((a, b) => b.score - a.score)[0];
      const label = category?.categoryName.toLowerCase();
      if (
        (label !== 'left' && label !== 'right') ||
        !Number.isFinite(category.score) ||
        category.score < VISION_LOW_CONFIDENCE
      )
        return null;
      const handedness: Handedness = mirror
        ? label === 'left'
          ? 'right'
          : 'left'
        : label;
      return { index, handedness, score: Math.min(1, category.score) };
    })
    .filter((candidate) => candidate !== null);
  return (
    candidates
      .filter((c) => hands.length === 1 || c.handedness === affected)
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
