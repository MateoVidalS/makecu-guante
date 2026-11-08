import { CURRENT_FLEX_MODEL } from '../contracts/calibration';
import { describe, expect, it } from 'vitest';
import { FINGERS, fingerMap, jointAngles, type Landmark } from './flex';
import { handLandmarks, observe, NOISE, rng } from './perf/handModel';
import { POSES } from '../contracts/poses';
import { JointFilter } from './jointFilter';
import { FrameProcessor } from './frameProcessor';

const angles = (degrees: number) =>
  fingerMap((finger) => ({
    mcp: degrees,
    pip: degrees,
    dip: finger === 'thumb' ? 0 : degrees,
  }));

describe('signed flexion in the hand flexion planes', () => {
  it('preserves flexion and hyperextension for both hands, views and rigid rotations', () => {
    for (const view of ['front_upright', 'front_diagonal'] as const)
      for (const hand of ['right', 'left'] as const)
        for (const degrees of [-5, 0, 15, 50, 95])
          for (const size of [0.75, 1, 1.25])
            for (const tilt of [
              {},
              { yaw: 30 },
              { yaw: -30 },
              { pitch: 30 },
              { pitch: -30 },
              { roll: 30 },
              { roll: -30 },
            ]) {
              const result = observe(
                handLandmarks(angles(degrees), { size }),
                {
                  view,
                  hand,
                  tilt,
                  noise: NOISE.ideal,
                },
                rng(1),
              );
              const world = result.worldLandmarks[0].map(
                ({ x, y, z }): Landmark => [x, y, z],
              );
              const measured = jointAngles(world, view, hand);
              for (const finger of FINGERS)
                for (const joint of ['mcp', 'pip', 'dip'] as const)
                  expect(
                    measured[finger][joint],
                    `${view} ${hand} ${finger} ${joint}`,
                  ).toBeCloseTo(angles(degrees)[finger][joint], 6);
            }
  });

  it('anchors anatomy independently: distal cross palmar points toward a right thumb', () => {
    const right = handLandmarks(angles(0));
    // In this explicitly specified frame distal=+Y and palmar=+Z, so a right
    // thumb must be at +X. The previous model called its -X thumb "right".
    expect(right[9][1]).toBeGreaterThan(right[0][1]);
    expect(right[2][0]).toBeGreaterThan(right[9][0]);
    expect(right[5][0]).toBeGreaterThan(right[17][0]);
  });

  it('models thumb opposition across the palm with a palmar component', () => {
    const open = handLandmarks(angles(0));
    const fist = handLandmarks(angles(50));
    expect(fist[4][0]).toBeLessThan(open[4][0] - 0.02);
    expect(fist[4][2]).toBeGreaterThan(0);
  });

  it('measures positive, increasing flexion for an anatomical right hand and its left mirror', () => {
    for (const view of ['front_upright', 'front_diagonal'] as const)
      for (const hand of ['right', 'left'] as const) {
        const sums = [0, 0.5, 1].map((level) => {
          const pose = fingerMap((finger) => ({
            mcp: POSES.full_fist.render[finger].mcp * level,
            pip: POSES.full_fist.render[finger].pip * level,
            dip: POSES.full_fist.render[finger].dip * level,
          }));
          const points = handLandmarks(pose).map(([x, y, z]): Landmark => [
            hand === 'left' ? -x : x,
            y,
            z,
          ]);
          const measured = jointAngles(points, view, hand);
          return fingerMap(
            (f) => measured[f].mcp + measured[f].pip + measured[f].dip,
          );
        });
        for (const finger of FINGERS) {
          expect(sums[0][finger]).toBeCloseTo(0, 6);
          expect(sums[1][finger]).toBeGreaterThan(sums[0][finger]);
          expect(sums[2][finger]).toBeGreaterThan(sums[1][finger]);
          expect(sums[2][finger] - sums[0][finger]).toBeGreaterThan(
            finger === 'thumb' ? 30 : 100,
          );
        }
      }
  });

  it('exposes a wrong configured hand through reversed long-finger flexion', () => {
    for (const view of ['front_upright', 'front_diagonal'] as const) {
      const left = handLandmarks(angles(40)).map(([x, y, z]): Landmark => [
        -x,
        y,
        z,
      ]);
      const correct = jointAngles(left, view, 'left');
      const wrong = jointAngles(left, view, 'right');
      for (const finger of ['index', 'middle', 'ring', 'pinky'] as const) {
        expect(
          correct[finger].mcp + correct[finger].pip + correct[finger].dip,
        ).toBeGreaterThan(100);
        expect(
          wrong[finger].mcp + wrong[finger].pip + wrong[finger].dip,
        ).toBeLessThan(-100);
      }
      // Thumb direction comes from landmarks and must not depend on the label.
      expect(wrong.thumb).toEqual(correct.thumb);
    }
  });

  it('keeps correlated landmark errors cancelling across filtered joints', () => {
    const filter = new JointFilter();
    for (let i = 0; i < 120; i++) {
      const noise = i % 2 ? 4 : -4;
      const input = fingerMap((finger) =>
        finger === 'thumb'
          ? { mcp: 30 + noise, pip: 30 - noise, dip: 0 }
          : { mcp: 30 + 2 * noise, pip: 30 - 3 * noise, dip: 30 + noise },
      );
      const output = filter.filter(input, (i * 1000) / 30);
      for (const finger of FINGERS)
        expect(
          output[finger].mcp + output[finger].pip + output[finger].dip,
        ).toBeCloseTo(finger === 'thumb' ? 60 : 90, 10);
    }
  });

  it('filters negative joints before deriving raw sums and clamping closure', () => {
    for (const hand of ['right', 'left'] as const) {
      const processor = new FrameProcessor();
      processor.calibration = {
        affected_hand: hand,
        camera_view: 'front_upright',
        flex_model: CURRENT_FLEX_MODEL,
        open_flex: fingerMap(() => 0),
        closed_flex: fingerMap(() => 100),
        pinch_open: 1,
        pinch_closed: 0.1,
      };
      const result = observe(
        handLandmarks(angles(-5)),
        {
          view: 'front_upright',
          hand,
          noise: NOISE.ideal,
        },
        rng(1),
      );
      // The configured hand controls geometry even when the detector label disagrees.
      result.handedness[0][0].categoryName = hand === 'left' ? 'Right' : 'Left';
      const frame = processor.process(result, 0, hand);
      for (const finger of FINGERS) {
        expect(frame.joints![finger].mcp).toBeCloseTo(-5);
        expect(frame.rawFlexSum![finger]).toBeCloseTo(
          finger === 'thumb' ? -10 : -15,
        );
        expect(frame.closure![finger]).toBe(0);
      }
    }
  });
});
