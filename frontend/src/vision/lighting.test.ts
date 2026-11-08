import { describe, expect, it, vi } from 'vitest';
import { measureLighting, VideoLightingSampler } from './lighting';
import type { Landmark } from './flex';
import { VisionRobustnessTracker } from './robustness';
import { missingFrame } from './frameProcessor';
import { fingerMap } from './flex';

const pixels = (value: (x: number, y: number) => number) =>
  new Uint8ClampedArray(
    Array.from({ length: 100 }, (_, i) => {
      const v = value(i % 10, Math.floor(i / 10));
      return [v, v, v, 255];
    }).flat(),
  );
const region: Landmark[] = Array.from({ length: 21 }, (_, i) =>
  i % 2 ? [0.2, 0.2, 0] : [0.5, 0.8, 0],
);
const seen = (t: number) => ({
  ...missingFrame(t),
  detected: true,
  confidence: 0.95,
  joints: fingerMap(() => ({ mcp: 0, pip: 0, dip: 0 })),
  landmarks: region,
});

describe('frame exposure and backlight heuristics', () => {
  it('distinguishes well-lit, dark and backlit hand regions', () => {
    expect(
      measureLighting(
        pixels(() => 140),
        10,
        10,
        region,
      ),
    ).toMatchObject({
      status: 'good',
      meanLuminance: expect.closeTo(140 / 255),
    });
    expect(
      measureLighting(
        pixels(() => 20),
        10,
        10,
        null,
      ),
    ).toMatchObject({ status: 'low_light', handLuminance: null });
    const backlit = measureLighting(
      pixels((x, y) => (x >= 2 && x < 5 && y >= 2 && y < 8 ? 30 : 240)),
      10,
      10,
      region,
    )!;
    expect(backlit.status).toBe('backlit');
    expect(backlit.handLuminance).toBeCloseTo(30 / 255);
    expect(backlit.backgroundLuminance).toBeCloseTo(240 / 255);
    expect(backlit.meanLuminance).toBeGreaterThan(0.7);
    expect(
      measureLighting(
        pixels(() => 140),
        10,
        10,
        null,
      )?.status,
    ).toBe('good');
  });
  it('handles malformed frames, clipped hands and unavailable canvas without stopping vision', () => {
    expect(measureLighting(new Uint8ClampedArray(), 0, 0, null)).toBeNull();
    expect(
      measureLighting(
        pixels(() => 20),
        1,
        1,
        null,
      ),
    ).toBeNull();
    expect(
      measureLighting(
        pixels(() => 20),
        10,
        10,
        region.map(() => [NaN, 0, 0]),
      )?.handLuminance,
    ).toBeNull();
    const video = document.createElement('video');
    const sampler = new VideoLightingSampler();
    expect(sampler.sample(video, region)).toBeNull();
    Object.defineProperties(video, {
      videoWidth: { value: 640 },
      videoHeight: { value: 480 },
    });
    const context = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => {
        throw new Error('No canvas');
      });
    expect(sampler.sample(video, region)).toBeNull();
    context.mockRestore();
  });
  it.each(['low_light', 'backlit'] as const)(
    'provides %s guidance immediately and includes it in the time-weighted check',
    (status) => {
      const tracker = new VisionRobustnessTracker();
      const lighting =
        status === 'low_light'
          ? measureLighting(
              pixels(() => 20),
              10,
              10,
              region,
            )!
          : measureLighting(
              pixels((x, y) => (x >= 2 && x < 5 && y >= 2 && y < 8 ? 30 : 240)),
              10,
              10,
              region,
            )!;
      for (let t = 0; t <= 5000; t += 50)
        tracker.add(seen(t), { lighting, handednessMismatch: true });
      const stats = tracker.stats(5000);
      expect(stats).toMatchObject({
        status: 'poor',
        lighting: { status },
        handednessMismatchRate: 1,
      });
      expect(stats.guidance.join(' ')).toContain(
        status === 'backlit' ? 'window behind you' : 'light in front of you',
      );
      expect(stats.guidance.join(' ')).toContain('affected-hand setting');
      expect(tracker.stats(10100).lighting).toBeNull();
      expect(tracker.stats(10100).handednessMismatchRate).toBeNull();
      tracker.reset(0);
      tracker.add(seen(0), { lighting, handednessMismatch: false });
      expect(tracker.stats(50).guidance.join(' ')).toContain(
        status === 'backlit' ? 'window behind you' : 'light in front of you',
      );
      tracker.reset();
      expect(tracker.stats(50).lighting).toBeNull();
    },
  );
  it('does not invent exposure or hand-label measurements for a simulator or unknown label', () => {
    const tracker = new VisionRobustnessTracker();
    for (let t = 0; t <= 5000; t += 50) tracker.add(seen(t));
    expect(tracker.stats(5000)).toMatchObject({
      status: 'ready',
      lighting: null,
      handednessMismatchRate: null,
    });
  });
});
