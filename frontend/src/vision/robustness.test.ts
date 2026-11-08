import { describe, expect, it } from 'vitest';
import { missingFrame } from './frameProcessor';
import { fingerMap } from './flex';
import { ROBUSTNESS_THRESHOLDS, VisionRobustnessTracker } from './robustness';
import type { VisionFrame } from '../contracts/vision';

const seen = (t: number): VisionFrame => ({
  ...missingFrame(t),
  detected: true,
  confidence: 0.95,
  handedness: 'right',
  joints: fingerMap(() => ({ mcp: 0, pip: 0, dip: 0 })),
  landmarks: Array.from({ length: 21 }, () => [0.5, 0.5, 0]),
});
const held = (change: (frame: VisionFrame) => VisionFrame = (f) => f) => {
  const tracker = new VisionRobustnessTracker();
  tracker.reset(0);
  for (let t = 0; t <= 5000; t += 50) tracker.add(change(seen(t)));
  return tracker;
};

describe('five-second hand robustness', () => {
  it('collects a complete window before declaring ready and exposes thresholds', () => {
    const tracker = held();
    expect(tracker.stats(5000)).toMatchObject({
      status: 'ready',
      observedMs: 5000,
      detectionRate: 1,
      meanConfidence: expect.closeTo(0.95),
      perFingerVisibility: fingerMap(() => 1),
    });
    tracker.reset(5000);
    tracker.add(seen(5000));
    expect(tracker.stats(5050).status).toBe('collecting');
    const guidance = tracker.stats(5050).guidance.join(' ');
    for (const text of [
      'whole hand in frame',
      'Roll up your sleeve',
      'remove rings, your watch and bracelets',
      'Keep points clear of the joint creases on your palm side',
    ])
      expect(guidance).toContain(text);
    expect(ROBUSTNESS_THRESHOLDS.windowMs).toBe(5000);
  });
  it('weights time rather than sample count and counts missing confidence as zero', () => {
    const tracker = new VisionRobustnessTracker();
    for (let t = 0; t < 2500; t += 25) tracker.add(seen(t));
    for (let t = 2500; t <= 5000; t += 50) tracker.add(missingFrame(t));
    expect(tracker.stats(5000)).toMatchObject({
      status: 'poor',
      detectionRate: 0.5,
      meanConfidence: expect.closeTo(0.475),
      perFingerVisibility: fingerMap(() => 0.5),
    });
    expect(tracker.stats(5000).guidance.join(' ')).toContain('40–60 cm');
    expect(tracker.stats(5000).guidance.join(' ')).toContain(
      'keep points small and on the back of your fingers',
    );
    expect(tracker.stats(5000).guidance.join(' ')).toContain(
      'good light from in front of you, with no window behind you',
    );
  });
  it('expires stalled frames and ages old detections out of the rolling window', () => {
    const tracker = held();
    expect(tracker.stats(10000)).toMatchObject({
      status: 'poor',
      detectionRate: 0.02,
      meanConfidence: expect.closeTo(0.019),
    });
    expect(tracker.stats(10100).detectionRate).toBe(0);
    tracker.add(seen(10100));
    expect(tracker.stats(10150).detectionRate).toBeCloseTo(0.01);
  });
  it('reports ring/pinky separately when clipped, invalid or unavailable', () => {
    const tracker = held((f) => {
      f.landmarks![20][0] = 1.1;
      f.joints!.ring.pip = NaN;
      return f;
    });
    const stats = tracker.stats(5000);
    expect(stats.detectionRate).toBe(1);
    expect(stats.status).toBe('poor');
    expect(stats.perFingerVisibility).toEqual({
      thumb: 1,
      index: 1,
      middle: 1,
      ring: 0,
      pinky: 0,
    });
    expect(stats.guidance.join(' ')).toContain('ring, pinky');
    expect(
      held((f) => ({ ...f, landmarks: null })).stats(5000).perFingerVisibility,
    ).toEqual(fingerMap(() => 0));
  });
  it('rejects low/invalid confidence, duplicate and out-of-order timestamps, and resets', () => {
    for (const confidence of [0.59, NaN, Infinity]) {
      const tracker = held((f) => ({ ...f, confidence }));
      expect(tracker.stats(5000).detectionRate).toBe(0);
      tracker.add(seen(5000));
      tracker.add(seen(4999));
      tracker.add(seen(NaN));
      expect(tracker.stats(5050).detectionRate).toBe(0);
      tracker.reset();
      expect(tracker.stats(5050)).toMatchObject({
        status: 'collecting',
        samples: 0,
        observedMs: 0,
      });
    }
  });
});
