import { describe, expect, it } from 'vitest';
import { stableCapture, validRange, fingers } from './draft';
import type { VisionFrame, FingerId } from '../../contracts/vision';
function frames(): VisionFrame[] {
  return Array.from({ length: 61 }, (_, i) => ({
    t: i * 33,
    detected: true,
    confidence: 0.95,
    handedness: 'right',
    rawFlexSum: Object.fromEntries(fingers.map((f) => [f, 40])) as Record<
      FingerId,
      number
    >,
    closure: null,
    joints: null,
    pinch: 0.4,
    landmarks: null,
  }));
}
describe('safe calibration validation', () => {
  it('allows mirrored mounts and enforces firmware angle bounds and minimum travel', () => {
    expect(validRange({ min_deg: 150, max_deg: 20 })).toBe(true);
    for (const range of [
      { min_deg: 20, max_deg: 39 },
      { min_deg: 0, max_deg: 170 },
      { min_deg: 20, max_deg: 180 },
      { min_deg: NaN, max_deg: 40 },
      {},
    ])
      expect(validRange(range)).toBe(false);
  });
  it('averages a stable two-second capture', () => {
    expect(stableCapture(frames())).toEqual({
      raw: { thumb: 40, index: 40, middle: 40, ring: 40, pinky: 40 },
      pinch: expect.closeTo(0.4),
    });
  });
  it('rejects brief, missing, moving and low-confidence captures', () => {
    expect(() => stableCapture(frames().slice(0, 20))).toThrow(/view/);
    for (const patch of [
      { detected: false },
      { confidence: 0.3 },
      { rawFlexSum: null },
      { rawFlexSum: { thumb: 60, index: 60, middle: 60, ring: 60, pinky: 60 } },
      { pinch: 0.6 },
    ]) {
      const values = frames();
      values[30] = { ...values[30], ...patch };
      expect(() => stableCapture(values)).toThrow();
    }
  });
});
