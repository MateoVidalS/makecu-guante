import { describe, expect, it } from 'vitest';
import { calibration } from '../contracts/fixtures.check';
import type { VisionFrame } from '../contracts/vision';
import { validateCameraRange } from './calibrationValidation';
const camera = {
  ...calibration.camera,
  closed_flex: { thumb: 100, index: 270, middle: 270, ring: 270, pinky: 270 },
};

describe('camera range validation', () => {
  it('accepts the known simulator range and flags an incompatible example range', () => {
    expect(() => validateCameraRange(camera, true, null)).not.toThrow();
    expect(() => validateCameraRange(calibration.camera, true, null)).toThrow(
      'over 100% for your index',
    );
  });
  it.each(['thumb', 'index', 'middle', 'ring', 'pinky'] as const)(
    'flags an undersized %s camera span before saving',
    (finger) => {
      expect(() =>
        validateCameraRange(
          {
            ...camera,
            closed_flex: {
              ...camera.closed_flex,
              [finger]: camera.closed_flex[finger] / 1.1,
            },
          },
          true,
          null,
        ),
      ).toThrow(`over 100% for your ${finger}`);
      expect(() =>
        validateCameraRange(
          { ...camera, closed_flex: { ...camera.closed_flex, [finger]: 0 } },
          true,
          null,
        ),
      ).toThrow('valid open and closed');
    },
  );
  it('uses observed raw flex for a real camera, without assuming simulated anatomy', () => {
    expect(() =>
      validateCameraRange(calibration.camera, false, null),
    ).not.toThrow();
    const frame = {
      detected: true,
      confidence: 0.95,
      rawFlexSum: { thumb: 80, index: 220, middle: 180, ring: 180, pinky: 180 },
    } as VisionFrame;
    expect(() => validateCameraRange(calibration.camera, false, frame)).toThrow(
      'over 100% for your index',
    );
    expect(() =>
      validateCameraRange(calibration.camera, false, {
        ...frame,
        confidence: 0.4,
      }),
    ).not.toThrow();
  });
});
