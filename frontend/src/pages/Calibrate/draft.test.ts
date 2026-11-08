import { describe, expect, it } from 'vitest';
import {
  stableCapture,
  validRange,
  fingers,
  draftFromCalibration,
  loadDraft,
} from './draft';
import { calibration } from '../../contracts/fixtures.check';
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

describe('view-aware calibration drafts', () => {
  it.each([undefined, 'front_diagonal'] as const)(
    'clears old %s camera captures and retains glove ranges and friction',
    (camera_view) => {
      const saved = {
        ...calibration,
        assist_direction: 'open' as const,
        camera: { ...calibration.camera, camera_view },
      };
      const draft = draftFromCalibration(saved);
      expect(draft).toMatchObject({
        step: 1,
        cameraView: 'front_upright',
        open: null,
        closed: null,
        pinch: null,
        friction: saved.friction,
        limit: saved.current_limit_ma,
      });
      expect(Object.values(draft.servo)).toEqual(saved.servo);
    },
  );
  it('retains current-view captures for review', () => {
    const draft = draftFromCalibration({
      ...calibration,
      assist_direction: 'open' as const,
      camera: { ...calibration.camera, camera_view: 'front_upright' },
    });
    expect(draft.step).toBe(2);
    expect(draft.open?.raw).toEqual(calibration.camera.open_flex);
    expect(draft.closed?.raw).toEqual(calibration.camera.closed_flex);
  });
  it('migrates a resumed legacy draft without relabeling its old captures', () => {
    const draft = draftFromCalibration({
      ...calibration,
      assist_direction: 'open' as const,
      camera: { ...calibration.camera, camera_view: 'front_upright' },
    });
    sessionStorage.setItem(
      'rehab-calibration',
      JSON.stringify({ ...draft, cameraView: undefined, edited: true }),
    );
    const resumed = loadDraft();
    expect(resumed).toMatchObject({
      step: 1,
      open: null,
      closed: null,
      pinch: null,
      cameraView: 'front_upright',
      edited: true,
    });
    expect(resumed.servo).toEqual(draft.servo);
    sessionStorage.clear();
  });
});

it.each([undefined, 'close'] as const)(
  'clears servo, camera and friction values from %s assistance',
  (assist_direction) => {
    const draft = draftFromCalibration({ ...calibration, assist_direction });
    expect(draft).toMatchObject({
      step: 0,
      servo: {},
      open: null,
      closed: null,
      friction: {},
      assistDirection: 'open',
    });
  },
);
it('clears a resumed draft without an opening direction marker', () => {
  const draft = draftFromCalibration({
    ...calibration,
    assist_direction: 'open',
  });
  sessionStorage.setItem(
    'rehab-calibration',
    JSON.stringify({ ...draft, assistDirection: undefined }),
  );
  expect(loadDraft()).toMatchObject({
    step: 0,
    servo: {},
    open: null,
    closed: null,
    friction: {},
  });
  sessionStorage.clear();
});
