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
        resolve('src/vision/fixtures', `palm-down_${p}.json`),
        'utf8',
      ),
    ) as Clip,
  ]),
);
const sums = (pose: string) => {
  const joints = jointAngles(clips[pose].frames[0].worldLandmarks);
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

describe('synthetic palm-down, thumb-side diagonal view (not hardware validation)', () => {
  it('marks all six poses synthetic and projects finite in-frame landmarks', () => {
    for (const clip of Object.values(clips)) {
      expect(clip.source).toContain('synthetic');
      expect(clip.posture).toContain('palm-down');
      expect(clip.camera).toEqual({
        view: 'front diagonal, thumb side, above hand',
        distanceCm: 36,
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
          open_flex: sums('open'),
          closed_flex: sums('full_fist'),
          pinch_open: 1,
          pinch_closed: 0.1,
        };
        return processor.process(result(pose, hand), 0, hand);
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
    processor.process(result('open', 'right', 0, 'Right'), 0, 'right');
    const frame = processor.process(
      result('full_fist', 'right', 0, 'Left'),
      1000 / 30,
      'right',
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
    );
    for (const finger of FINGERS)
      expect(reacquired.rawFlexSum![finger]).toBeCloseTo(
        sums('full_fist')[finger],
        5,
      );
  });
});
