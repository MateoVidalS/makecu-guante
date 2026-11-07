import type { VisionFrame, FingerId } from '../contracts/vision';
export function captureStats(
  _frames: VisionFrame[],
  _seconds: number,
): { rawFlexSum: Record<FingerId, number>; pinch: number } {
  throw new Error('WP3');
}
