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
  it('preserves flexion and hyperextension for both hands, views and rigid rotations (upright: in-plane roll)', () => {
    // Upright long fingers measure against the lens axis, so only rotations in
    // the image plane leave them unchanged; pitch/yaw are covered below.
    const rolls = [{}, { roll: 30 }, { roll: -30 }];
    const tilts = {
      front_upright: rolls,
      front_diagonal: [
        ...rolls,
        { yaw: 30 },
        { yaw: -30 },
        { pitch: 30 },
        { pitch: -30 },
      ],
    };
    for (const view of ['front_upright', 'front_diagonal'] as const)
      for (const hand of ['right', 'left'] as const)
        for (const degrees of [-5, 0, 15, 50, 95])
          for (const size of [0.75, 1, 1.25])
            for (const tilt of tilts[view]) {
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
          // Upright world landmarks are camera-aligned like MediaPipe's: fingers
          // up (-y) and the palm to the lens (-z). The legacy view is frame-free.
          const upright = view === 'front_upright' ? -1 : 1;
          const points = handLandmarks(pose).map(([x, y, z]): Landmark => [
            hand === 'left' ? -x : x,
            upright * y,
            upright * z,
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

  it('exposes a wrong configured hand through reversed long-finger flexion (legacy view)', () => {
    const view = 'front_diagonal';
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
  });

  it('upright long fingers do not depend on the configured hand or the skeleton chirality', () => {
    // The palmar direction is the lens axis, so a wrong affected-hand setting
    // or a mirrored MediaPipe skeleton still reads flexion as flexion.
    for (const hand of ['right', 'left'] as const) {
      const world = observe(
        handLandmarks(angles(40)),
        { view: 'front_upright', hand, noise: NOISE.ideal },
        rng(1),
      ).worldLandmarks[0].map(({ x, y, z }): Landmark => [x, y, z]);
      const correct = jointAngles(world, 'front_upright', hand);
      const wrong = jointAngles(
        world,
        'front_upright',
        hand === 'right' ? 'left' : 'right',
      );
      for (const finger of ['index', 'middle', 'ring', 'pinky'] as const) {
        expect(wrong[finger]).toEqual(correct[finger]);
        expect(
          correct[finger].mcp + correct[finger].pip + correct[finger].dip,
        ).toBeCloseTo(120, 6);
      }
    }
  });

  it('measures upright MCP as the proximal bone elevation toward the lens', () => {
    // A hand leaning toward or away from the lens after calibration shifts MCP
    // by the lean of its proximal bones; PIP/DIP stay (nearly) unchanged.
    const unit = (v: number[]) => v.map((x) => x / Math.hypot(...v));
    for (const hand of ['right', 'left'] as const)
      // Elevations stay below 90°, where asin is an independent oracle.
      for (const degrees of [0, 30])
        for (const pitch of [-35, -15, 15, 35]) {
          const world = observe(
            handLandmarks(angles(degrees)),
            {
              view: 'front_upright',
              hand,
              noise: NOISE.ideal,
              tilt: { pitch },
            },
            rng(1),
          ).worldLandmarks[0].map(({ x, y, z }): Landmark => [x, y, z]);
          const measured = jointAngles(world, 'front_upright', hand);
          for (const [finger, base] of [
            ['index', 5],
            ['middle', 9],
            ['ring', 13],
            ['pinky', 17],
          ] as const) {
            const proximal = unit(
              [0, 1, 2].map((k) => world[base + 1][k] - world[base][k]),
            );
            const towardLens = (Math.asin(-proximal[2]) * 180) / Math.PI;
            const label = `${hand} ${finger} ${degrees} pitch ${pitch}`;
            expect(measured[finger].mcp, label).toBeCloseTo(towardLens, 6);
            expect(
              Math.abs(measured[finger].mcp - degrees),
              label,
            ).toBeGreaterThan(5);
            // Splayed fingers lean slightly across the lens-based flexion axis
            // (about 2° for the pinky at a 35° lean).
            expect(
              Math.abs(measured[finger].pip - degrees),
              label,
            ).toBeLessThan(3);
            expect(
              Math.abs(measured[finger].dip - degrees),
              label,
            ).toBeLessThan(3);
          }
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
      // The configured hand controls geometry even when the detector label
      // disagrees (unsurely: a confident opposite label drops the hand).
      result.handedness[0][0].categoryName = hand === 'left' ? 'Right' : 'Left';
      result.handedness[0][0].score = 0.8;
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

  // Known gap (accuracy round 1): upright, the thumb IP bends mostly along the camera
  // axis and MediaPipe can reverse that direction in runs of video frames; smoothing then
  // averages a bent thumb toward zero. An unsigned IP fixed this test but was not adopted,
  // because real upright device recordings show a genuinely hyperextended open thumb IP
  // (-17 to -22 deg), so the sign must stay. A fix needs to tell a flickering sign from a
  // real one (e.g. over time). Flip to `it` only when that is fixed.
  it.fails(
    'keeps a bent thumb bent when MediaPipe reverses its IP direction in runs of frames',
    () => {
      // Reflect the distal phalanx about the proximal phalanx: same bend magnitude,
      // opposite direction. True thumb flex sum: 30 + 40 = 70.
      const bent = handLandmarks(
        fingerMap((finger) =>
          finger === 'thumb'
            ? { mcp: 30, pip: 40, dip: 0 }
            : { mcp: 0, pip: 0, dip: 0 },
        ),
      );
      const sub = (a: Landmark, b: Landmark): Landmark => [
        a[0] - b[0],
        a[1] - b[1],
        a[2] - b[2],
      ];
      const axis = sub(bent[3], bent[2]);
      const u = axis.map((v) => v / Math.hypot(...axis)) as Landmark;
      const distal = sub(bent[4], bent[3]);
      const along = distal.reduce((s, v, k) => s + v * u[k], 0);
      const mirrored = bent.slice();
      mirrored[4] = bent[3].map(
        (v, k) => v + 2 * along * u[k] - distal[k],
      ) as Landmark;
      for (const hand of ['right', 'left'] as const) {
        const scene = {
          view: 'front_upright' as const,
          hand,
          noise: NOISE.ideal,
        };
        // The direction flips every 5 frames (30 fps); baseline publishes 17-30 of 70.
        const processor = new FrameProcessor();
        const published: number[] = [];
        for (let i = 0; i < 60; i++)
          published.push(
            processor.process(
              observe(
                Math.floor(i / 5) % 2 === 1 ? mirrored : bent,
                scene,
                rng(1),
              ),
              (i * 1000) / 30,
              hand,
            ).rawFlexSum!.thumb,
          );
        expect(Math.min(...published.slice(45)), hand).toBeGreaterThan(45);
      }
    },
  );
});
