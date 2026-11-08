import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Handedness } from '../contracts/vision';
import { captureStats } from './calibration';
import { FINGERS, fingerMap, jointAngles, type Landmark } from './flex';
import { FrameProcessor, type HandResult } from './frameProcessor';

type Clip = {
  source: string;
  posture: string;
  camera: { distanceCm: number; view: string };
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
  poses.map((p) => [
    p,
    JSON.parse(
      readFileSync(
        resolve('src/vision/fixtures', `front_upright_${p}.json`),
        'utf8',
      ),
    ) as Clip,
  ]),
);
const sums = (pose: string) => {
  const joints = jointAngles(
    clips[pose].frames[0].worldLandmarks,
    'front_upright',
  );
  return fingerMap((f) => joints[f].mcp + joints[f].pip + joints[f].dip);
};
const result = (
  pose: string,
  hand: Handedness,
  i = 0,
  label = 'Left',
): HandResult => {
  const points = (p: Landmark[]) =>
    p.map(([x, y, z]) => ({
      x: hand === 'left' ? -x : x,
      y,
      z,
      visibility: 1,
    }));
  const image = clips[pose].frames[i].landmarks.map(([x, y, z]) => ({
    x: hand === 'left' ? 1 - x : x,
    y,
    z,
    visibility: 1,
  }));
  return {
    landmarks: [image],
    worldLandmarks: [points(clips[pose].frames[i].worldLandmarks)],
    handedness: [
      [{ categoryName: label, score: 0.95, index: 0, displayName: '' }],
    ],
  };
};

describe('synthetic front-upright, palm-to-lens view (not hardware validation)', () => {
  it('marks all six poses synthetic and projects finite in-frame landmarks', () => {
    for (const clip of Object.values(clips)) {
      expect(clip.source).toContain('synthetic');
      expect(clip.posture).toContain('upright');
      expect(clip.camera).toEqual({
        view: 'front upright, palm to lens, no rotation',
        distanceCm: 50,
      });
      expect(clip.frames).toHaveLength(30);
      for (const frame of clip.frames) {
        expect(frame.worldLandmarks).toHaveLength(21);
        expect(
          frame.landmarks.every(
            ([x, y, z]) =>
              Number.isFinite(z) && x > 0 && x < 1 && y > 0 && y < 1,
          ),
        ).toBe(true);
      }
    }
  });
  it.each(['right', 'left'] as const)(
    'keeps closure ordering, five-finger endpoints and pinch for %s hand',
    (hand) => {
      const closure = (pose: string) => {
        const processor = new FrameProcessor();
        processor.calibration = {
          affected_hand: hand,
          camera_view: 'front_upright',
          open_flex: sums('open'),
          closed_flex: sums('full_fist'),
          pinch_open: 1,
          pinch_closed: 0.1,
        };
        return processor.process(
          result(pose, hand),
          0,
          hand,
          false,
          'front_upright',
        );
      };
      const frames = poses.map(closure);
      for (const finger of ['index', 'middle', 'ring', 'pinky'] as const) {
        const values = frames.slice(0, 5).map((f) => f.closure![finger]);
        for (let i = 1; i < values.length; i++)
          expect(values[i]).toBeGreaterThan(values[i - 1]);
      }
      for (const finger of FINGERS) {
        expect(frames[0].closure![finger]).toBeCloseTo(0, 5);
        expect(frames[4].closure![finger]).toBeCloseTo(1, 5);
      }
      expect(frames[5].pinch).toBeLessThan(0.13);
      expect(frames[5].pinch).toBeLessThan(
        Math.min(...frames.slice(0, 5).map((f) => f.pinch!)),
      );
      expect(frames.every((f) => f.handedness === hand)).toBe(true);
      // Calibration remains a hold-still capture of every actuated finger.
      const processor = new FrameProcessor();
      const held = Array.from({ length: 61 }, (_, i) =>
        processor.process(
          result('full_fist', hand, i % 30),
          (i * 1000) / 30,
          hand,
          false,
          'front_upright',
        ),
      );
      const captured = captureStats(held, 2);
      for (const finger of FINGERS)
        expect(captured.rawFlexSum[finger]).toBeCloseTo(
          sums('full_fist')[finger],
          2,
        );
    },
  );
  it('does not reset joint smoothing when a lone-hand MediaPipe label flips', () => {
    const processor = new FrameProcessor();
    processor.process(
      result('open', 'right', 0, 'Right'),
      0,
      'right',
      false,
      'front_upright',
    );
    const frame = processor.process(
      result('full_fist', 'right', 0, 'Left'),
      1000 / 30,
      'right',
      false,
      'front_upright',
    );
    for (const finger of FINGERS) {
      expect(frame.rawFlexSum![finger]).toBeGreaterThan(0);
      expect(frame.rawFlexSum![finger]).toBeLessThan(sums('full_fist')[finger]);
      expect(frame.rawFlexSum![finger]).toBeCloseTo(
        Object.values(frame.joints![finger]).reduce((a, b) => a + b, 0),
        5,
      );
    }
    const reacquired = processor.process(
      result('full_fist', 'right'),
      300,
      'right',
      false,
      'front_upright',
    );
    for (const finger of FINGERS)
      expect(reacquired.rawFlexSum![finger]).toBeCloseTo(
        sums('full_fist')[finger],
        5,
      );
  });
});

describe('upright flexion and label cross-check', () => {
  it('measures MCP against the palm plane through wrist tilt, splay, rigid transforms and mirroring', () => {
    for (const pose of poses) {
      const original = clips[pose].frames[0].worldLandmarks;
      const expected = jointAngles(original);
      const tilted: Landmark[] = original.map(([x, y, z]) => [
        2 * z + 0.4,
        2 * y - 0.7,
        -2 * x + 0.2,
      ]);
      // Move just the wrist out of the palm plane: MCP must not follow it.
      tilted[0][0] += 0.1;
      for (const [points, hand] of [
        [tilted, 'right'],
        [original.map(([x, y, z]): Landmark => [-x, y, z]), 'left'],
      ] as const) {
        const measured = jointAngles(points, 'front_upright', hand);
        for (const f of FINGERS)
          for (const joint of ['mcp', 'pip', 'dip'] as const)
            expect(measured[f][joint]).toBeCloseTo(expected[f][joint], 4);
      }
    }
    const open = jointAngles(clips.open.frames[0].worldLandmarks);
    for (const f of FINGERS) expect(open[f].mcp).toBeCloseTo(0, 4);
    const tabletop = jointAngles(clips.tabletop.frames[0].worldLandmarks);
    for (const f of ['index', 'middle', 'ring', 'pinky'] as const)
      expect(tabletop[f].mcp).toBeCloseTo(90, 4);
  });
  it('uses world landmarks when image landmarks are foreshortened, and rejects degenerate palms', () => {
    const processor = new FrameProcessor();
    const full = result('full_fist', 'right');
    full.landmarks = result('open', 'right').landmarks;
    expect(processor.process(full, 0, 'right').rawFlexSum!.index).toBeCloseTo(
      sums('full_fist').index,
    );
    full.worldLandmarks = [];
    expect(processor.process(full, 34, 'right').detected).toBe(false);
    const line = Array.from({ length: 21 }, (_, i): Landmark => [
      i / 100,
      0,
      0,
    ]);
    expect(() => jointAngles(line)).toThrow('Degenerate palm plane');
  });
  it('keeps the configured hand and smoothing on label mismatch; supports mirror correction and legacy mode', () => {
    const processor = new FrameProcessor();
    const right = result('open', 'right', 0, 'Right');
    processor.process(right, 0, 'right');
    expect(processor.handednessMismatch).toBe(false);
    const opposite = result('full_fist', 'right', 0, 'Left');
    const frame = processor.process(opposite, 34, 'right');
    expect(frame.handedness).toBe('right');
    expect(processor.handednessMismatch).toBe(true);
    expect(frame.rawFlexSum!.index).toBeLessThan(sums('full_fist').index);
    processor.process(opposite, 68, 'right', true);
    expect(processor.handednessMismatch).toBe(false);
    processor.process(opposite, 102, 'right', false, 'front_diagonal');
    expect(processor.handednessMismatch).toBeNull();
    processor.process(result('open', 'right', 0, 'Unknown'), 136, 'right');
    expect(processor.handednessMismatch).toBeNull();
    processor.missing(170);
    expect(processor.handednessMismatch).toBeNull();
  });
  it('never applies a calibration from the other view, including untagged legacy calibrations', () => {
    const processor = new FrameProcessor();
    processor.calibration = {
      affected_hand: 'right',
      open_flex: sums('open'),
      closed_flex: sums('full_fist'),
      pinch_open: 1,
      pinch_closed: 0.1,
    };
    const frame = result('full_fist', 'right');
    expect(processor.process(frame, 0, 'right').closure).toBeNull();
    expect(
      processor.process(frame, 34, 'right', false, 'front_diagonal').closure,
    ).not.toBeNull();
    processor.calibration.camera_view = 'front_upright';
    expect(
      processor.process(frame, 68, 'right', false, 'front_diagonal').closure,
    ).toBeNull();
    expect(processor.process(frame, 102, 'right').closure!.index).toBeCloseTo(
      1,
    );
  });
});
