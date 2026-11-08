import { describe, expect, it } from 'vitest';
import { calibration } from '../contracts/fixtures.check';
import type { VisionFrame } from '../contracts/vision';
import {
  validateCameraRange,
  selectCalibrationStatus,
  calibrationIssueHref,
} from './calibrationValidation';
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

describe('shared calibration status', () => {
  it('distinguishes missing, usable and invalid saved data', () => {
    expect(selectCalibrationStatus(null, true, null)).toEqual({
      state: 'missing',
      issues: [],
    });
    expect(
      selectCalibrationStatus({ ...calibration, camera }, true, null),
    ).toEqual({ state: 'ok', issues: [] });
    expect(selectCalibrationStatus(calibration, true, null)).toEqual({
      state: 'invalid',
      issues: ['index', 'middle', 'ring', 'pinky'].map((finger) => ({
        finger,
        step: 'camera',
        message: `Your ${finger} range needs a quick redo.`,
      })),
    });
  });
  it('checks every glove range, allowing mirrored mounts', () => {
    const value = structuredClone({ ...calibration, camera });
    value.servo[0] = { finger: 'thumb', min_deg: 150, max_deg: 20 };
    expect(selectCalibrationStatus(value, true, null).state).toBe('ok');
    value.servo = value.servo.filter((range) => range.finger !== 'ring');
    value.servo[1].min_deg = NaN;
    const status = selectCalibrationStatus(value, true, null);
    expect(status.issues.map(({ finger, step }) => [finger, step])).toEqual([
      ['index', 'glove'],
      ['ring', 'glove'],
    ]);
    expect(calibrationIssueHref(status.issues[1])).toBe(
      '/calibrate?step=glove&finger=ring',
    );
  });
  it('shares the runtime camera gate for real, lost and low-confidence frames', () => {
    const frame = {
      detected: true,
      confidence: 0.95,
      rawFlexSum: { thumb: 80, index: 220, middle: 180, ring: 180, pinky: 180 },
    } as VisionFrame;
    expect(
      selectCalibrationStatus(calibration, false, frame).issues[0],
    ).toEqual({
      finger: 'index',
      step: 'camera',
      message: 'Your index range needs a quick redo.',
    });
    expect(selectCalibrationStatus(calibration, false, null).state).toBe('ok');
    expect(
      selectCalibrationStatus(calibration, false, { ...frame, confidence: 0.4 })
        .state,
    ).toBe('ok');
  });
});
