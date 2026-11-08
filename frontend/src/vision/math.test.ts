import { CURRENT_FLEX_MODEL } from '../contracts/calibration';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureStats } from './calibration';
import { ConfidenceTracker, selectHand } from './confidence';
import {
  FINGERS,
  fingerMap,
  jointAngles,
  normalizeClosure,
  pinchRatio,
  type Landmark,
} from './flex';
import { OneEuroFilter } from './oneEuro';
import { FrameProcessor, type HandResult } from './frameProcessor';
import type { VisionFrame } from '../contracts/vision';

type Clip = {
  source: string;
  frames: { t: number; worldLandmarks: Landmark[]; landmarks: Landmark[] }[];
};
const poses = [
  'open',
  'tabletop',
  'hook',
  'straight_fist',
  'full_fist',
  'pinch',
];
const clips = Object.fromEntries(
  poses.map((pose) => [
    pose,
    JSON.parse(
      readFileSync(
        resolve('..', 'contracts', 'fixtures', `landmarks_${pose}.json`),
        'utf8',
      ),
    ) as Clip,
  ]),
);
// Frozen legacy contract recordings use the old mirrored "right" geometry.
// Reflect their test input into an anatomical right hand without changing fixtures.
for (const clip of Object.values(clips))
  for (const frame of clip.frames) {
    frame.worldLandmarks = frame.worldLandmarks.map(([x, y, z]) => [-x, y, z]);
    frame.landmarks = frame.landmarks.map(([x, y, z]) => [1 - x, y, z]);
  }
const result = (clip: Clip, i = 0): HandResult => ({
  landmarks: [
    clip.frames[i].landmarks.map(([x, y, z]) => ({ x, y, z, visibility: 1 })),
  ],
  worldLandmarks: [
    clip.frames[i].worldLandmarks.map(([x, y, z]) => ({
      x,
      y,
      z,
      visibility: 1,
    })),
  ],
  handedness: [
    [{ categoryName: 'Right', score: 0.95, displayName: '', index: 0 }],
  ],
});
const flex = (pose: string) => {
  const joints = jointAngles(clips[pose].frames[0].worldLandmarks);
  return fingerMap((f) => joints[f].mcp + joints[f].pip + joints[f].dip);
};
const calibration = {
  affected_hand: 'right' as const,
  camera_view: 'front_upright' as const,
  flex_model: CURRENT_FLEX_MODEL,
  open_flex: flex('open'),
  closed_flex: flex('full_fist'),
  pinch_open: 1.5,
  pinch_closed: 0.1,
};

describe('synthetic landmark fixtures', () => {
  it('contains 30 model-generated frames per pose, with expected closure ordering and pinch contact', () => {
    for (const clip of Object.values(clips)) {
      expect(clip.source).toContain('synthetic');
      expect(clip.frames).toHaveLength(30);
      for (const frame of clip.frames) {
        expect(frame.worldLandmarks).toHaveLength(21);
        const angles = jointAngles(frame.worldLandmarks);
        for (const f of FINGERS)
          expect(Object.values(angles[f]).every(Number.isFinite)).toBe(true);
      }
    }
    const sums = poses.slice(0, 5).map((p) => flex(p).index);
    expect(sums[0]).toBeCloseTo(0, 3);
    expect(sums[1]).toBeCloseTo(90, 3);
    expect(sums[2]).toBeCloseTo(160, 3);
    expect(sums[3]).toBeCloseTo(180, 3);
    expect(sums[4]).toBeCloseTo(260, 3);
    const closures = sums.map((v) =>
      normalizeClosure(
        v,
        calibration.open_flex.index,
        calibration.closed_flex.index,
      ),
    );
    for (let i = 1; i < closures.length; i++)
      expect(closures[i]).toBeGreaterThan(closures[i - 1]);
    const pinches = poses.map((p) => pinchRatio(clips[p].frames[0].landmarks));
    expect(pinches.at(-1)).toBeLessThan(Math.min(...pinches.slice(0, -1)));
  });
  it('keeps 3D angles and pinch invariant under rigid transforms and scale', () => {
    const frame = clips.hook.frames[0];
    const transform = (points: Landmark[]): Landmark[] =>
      points.map(([x, y, z]) => [2 * z + 1, 2 * y - 3, -2 * x + 5]);
    const a = jointAngles(frame.worldLandmarks),
      b = jointAngles(transform(frame.worldLandmarks));
    for (const f of FINGERS)
      for (const j of ['mcp', 'pip', 'dip'] as const)
        expect(a[f][j]).toBeCloseTo(b[f][j], 4);
    expect(pinchRatio(frame.landmarks)).toBeCloseTo(
      pinchRatio(transform(frame.landmarks)),
      5,
    );
    expect(jointAngles(frame.worldLandmarks).thumb.dip).toBe(0);
  });
  it('clamps normalized closure and safely handles invalid calibration and landmarks', () => {
    expect(normalizeClosure(20, 30, 200)).toBe(0);
    expect(normalizeClosure(400, 30, 200)).toBe(1.1);
    expect(normalizeClosure(115, 30, 200)).toBe(0.5);
    for (const args of [
      [1, 1, 1],
      [3, 2, 1],
      [NaN, 0, 1],
    ])
      expect(normalizeClosure(...(args as [number, number, number]))).toBe(0);
    expect(() => jointAngles([])).toThrow();
    expect(() =>
      jointAngles(Array.from({ length: 21 }, (): Landmark => [0, 0, 0])),
    ).toThrow();
    expect(() =>
      pinchRatio(Array.from({ length: 21 }, (): Landmark => [0, 0, 0])),
    ).toThrow();
  });
});

describe('One Euro filter', () => {
  it.each([90, 180, 260])(
    'settles a %d degree flexion step within 200ms, without overshoot',
    (step) => {
      const filter = new OneEuroFilter();
      expect(filter.filter(0, 0)).toBe(0);
      const response = Array.from({ length: 30 }, (_, i) =>
        filter.filter(step, ((i + 1) * 1000) / 30),
      );
      expect(response[5]).toBeGreaterThanOrEqual(step * 0.95);
      expect(Math.max(...response)).toBeLessThanOrEqual(step * 1.05);
      for (let i = 1; i < response.length; i++)
        expect(response[i]).toBeGreaterThanOrEqual(response[i - 1]);
    },
  );
  it('attenuates stationary tremor, resets on reacquisition, and ignores duplicate timestamps', () => {
    const filter = new OneEuroFilter();
    let output = 0;
    for (let i = 0; i < 120; i++)
      output = filter.filter(100 + (i % 2 ? 2 : -2), (i * 1000) / 30);
    expect(Math.abs(output - 100)).toBeLessThan(1);
    expect(filter.filter(200, 100)).toBe(output);
    filter.reset();
    expect(filter.filter(0, 0)).toBe(0);
    expect(() => filter.filter(NaN, 1)).toThrow();
  });
});

describe('hand selection and confidence', () => {
  const left = [{ categoryName: 'Left', score: 0.99 }],
    right = [{ categoryName: 'Right', score: 0.8 }];
  it('selects affected hand, accepts a lone high-confidence hand, and mirrors labels', () => {
    expect(selectHand([left, right], 'right')?.index).toBe(1);
    expect(selectHand([left, right], 'right', true)?.index).toBe(0);
    expect(selectHand([left], 'right')?.handedness).toBe('right');
    expect(selectHand([right], 'left', true)?.handedness).toBe('left');
    expect(
      selectHand([[{ categoryName: 'Unknown', score: 0.9 }]], 'left')
        ?.handedness,
    ).toBe('left');
    expect(selectHand([[]], 'right')).toBeNull();
    expect(
      selectHand([left, [{ categoryName: 'Right', score: 0.2 }]], 'right'),
    ).toBeNull();
    expect(
      selectHand([[{ categoryName: 'Right', score: 0.59 }]], 'right'),
    ).toBeNull();
    expect(selectHand([], 'right')).toBeNull();
  });
  it('decays internal presence to zero in 200ms', () => {
    const confidence = new ConfidenceTracker();
    expect(confidence.update(null, 0)).toBe(0);
    expect(confidence.update(0.9, 0)).toBe(0.9);
    expect(confidence.update(null, 100)).toBeCloseTo(0.45);
    expect(confidence.update(0.2, 200)).toBe(0);
    expect(confidence.value(300)).toBe(0);
  });
});

describe('frame processing and calibration capture', () => {
  it('produces calibrated filtered frames and immediately clears unsafe observations', () => {
    const processor = new FrameProcessor();
    expect(
      processor.process(result(clips.open), 0, 'right').closure,
    ).toBeNull();
    processor.calibration = calibration;
    const frame = processor.process(result(clips.open), 34, 'right');
    expect(frame.detected).toBe(true);
    expect(frame.closure!.index).toBeCloseTo(0, 4);
    for (const missing of [
      { landmarks: [], worldLandmarks: [], handedness: [] },
      {
        ...result(clips.open),
        handedness: [
          [{ categoryName: 'Right', score: 0.3, displayName: '', index: 0 }],
        ],
      },
    ]) {
      expect(processor.process(missing, 67, 'right')).toMatchObject({
        detected: false,
        closure: null,
        confidence: 0,
        joints: null,
        rawFlexSum: null,
      });
    }
    const reacquired = processor.process(result(clips.full_fist), 300, 'right');
    expect(reacquired.closure!.index).toBeCloseTo(1, 4);
    expect(
      reacquired.joints!.index.mcp +
        reacquired.joints!.index.pip +
        reacquired.joints!.index.dip,
    ).toBeCloseTo(reacquired.rawFlexSum!.index);
    expect(
      processor.process(result(clips.open), 334, 'left').closure,
    ).toBeNull();
  });
  const held = (): VisionFrame[] =>
    Array.from({ length: 61 }, (_, i) => ({
      t: (i * 1000) / 30,
      detected: true,
      confidence: 0.95,
      handedness: 'right',
      closure: null,
      rawFlexSum: fingerMap(() => 50 + (i % 3)),
      joints: null,
      pinch: 0.2 + (i % 3) * 0.01,
      landmarks: null,
    }));
  it('captures medians over the latest full hold-still window and rejects movement', () => {
    const frames = held();
    expect(captureStats(frames, 2).rawFlexSum).toEqual(fingerMap(() => 51));
    expect(captureStats(frames, 2).pinch).toBeCloseTo(0.21);
    frames[5].rawFlexSum!.index = 150;
    expect(() => captureStats(frames, 2)).toThrow('movement');
  });
  it('captures distinct glove-closed values and rejects movement in ring and pinky', () => {
    const frames = held();
    for (const frame of frames)
      frame.rawFlexSum = {
        thumb: 90,
        index: 190,
        middle: 200,
        ring: 180,
        pinky: 160,
      };
    expect(captureStats(frames, 2).rawFlexSum).toEqual(frames[0].rawFlexSum);
    for (const finger of ['ring', 'pinky'] as const) {
      const moving = structuredClone(frames);
      moving[5].rawFlexSum![finger] += 100;
      expect(() => captureStats(moving, 2)).toThrow('movement');
    }
  });
  it('rejects short, sparse, missing, non-finite and out-of-order windows', () => {
    expect(() => captureStats(held().slice(0, 20), 2)).toThrow();
    expect(() => captureStats([], 2)).toThrow();
    expect(() => captureStats(held(), 0)).toThrow();
    for (const corrupt of [
      (f: VisionFrame[]) => {
        f[30].detected = false;
      },
      (f: VisionFrame[]) => {
        f[30].pinch = NaN;
      },
      (f: VisionFrame[]) => {
        f[30].confidence = NaN;
      },
      (f: VisionFrame[]) => {
        f[30].handedness = 'left';
      },
      (f: VisionFrame[]) => {
        f[30].t = f[29].t;
      },
      (f: VisionFrame[]) => {
        f.splice(20, 4);
      },
    ]) {
      const frames = held();
      corrupt(frames);
      expect(() => captureStats(frames, 2)).toThrow();
    }
  });
});
