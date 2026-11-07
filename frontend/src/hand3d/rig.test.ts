import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { POSES } from '../contracts/poses';
import {
  applyJoints,
  createHandRig,
  FINGERS,
  HAND_PROPORTIONS,
  JOINTS,
  jointsFromClosure,
} from './rig';
const closure = (amount: number) => ({
  thumb: amount,
  index: amount,
  middle: amount,
  ring: amount,
  pinky: amount,
});
const position = (
  rig: ReturnType<typeof createHandRig>,
  finger: (typeof FINGERS)[number],
) => {
  rig.updateMatrixWorld(true);
  return rig.fingers[finger].tip.getWorldPosition(new Vector3());
};

describe('procedural hand transforms', () => {
  it('places open fingertips at the end of each parent chain', () => {
    const rig = createHandRig();
    applyJoints(rig, POSES.open.render);
    const middle = HAND_PROPORTIONS.middle;
    expect(position(rig, 'middle').y).toBeCloseTo(
      middle.base[1] + middle.lengths.reduce((a, b) => a + b, 0),
    );
    expect(position(rig, 'middle').z).toBeCloseTo(0);
  });
  it('flexes at the MCP and preserves PIP/DIP child lengths', () => {
    const rig = createHandRig();
    applyJoints(rig, POSES.tabletop.render);
    const tip = position(rig, 'middle');
    expect(tip.y).toBeCloseTo(HAND_PROPORTIONS.middle.base[1]);
    expect(tip.z).toBeCloseTo(
      HAND_PROPORTIONS.middle.lengths.reduce((a, b) => a + b, 0),
    );
  });
  it('keeps the hook MCP straight while curling distal joints', () => {
    const rig = createHandRig();
    applyJoints(rig, POSES.hook.render);
    expect(rig.fingers.middle.joints[0].rotation.x).toBeCloseTo(0);
    expect(position(rig, 'middle').y).toBeLessThan(
      position(createHandRig(), 'middle').y,
    );
    expect(position(rig, 'middle').z).toBeGreaterThan(0);
  });
  it('mirrors every fingertip across X for all six poses', () => {
    for (const pose of Object.values(POSES)) {
      const right = createHandRig(),
        left = createHandRig('left');
      applyJoints(right, pose.render);
      applyJoints(left, pose.render);
      for (const finger of FINGERS) {
        const a = position(right, finger),
          b = position(left, finger);
        expect(b.x).toBeCloseTo(-a.x);
        expect(b.y).toBeCloseTo(a.y);
        expect(b.z).toBeCloseTo(a.z);
      }
    }
  });
  it('slerps by half the angle and ignores thumb dip', () => {
    const rig = createHandRig();
    applyJoints(rig, POSES.full_fist.render, 0.5);
    expect(rig.fingers.middle.joints[0].rotation.x).toBeCloseTo(Math.PI / 4);
    applyJoints(rig, {
      ...POSES.open.render,
      thumb: { mcp: 0, pip: 0, dip: 100 },
    });
    expect(rig.fingers.thumb.joints[2].rotation.x).toBeCloseTo(0);
  });
});

describe('closure synthesis', () => {
  it('is monotonic and bounded with every pose hint, including open/free fingers', () => {
    for (const pose of [undefined, ...Object.values(POSES)]) {
      let previous = jointsFromClosure(closure(0), pose);
      for (let step = 1; step <= 110; step++) {
        const next = jointsFromClosure(closure(step / 100), pose);
        for (const finger of FINGERS)
          for (const joint of JOINTS) {
            expect(next[finger][joint]).toBeGreaterThanOrEqual(
              previous[finger][joint],
            );
            expect(next[finger][joint]).toBeLessThanOrEqual(
              joint === 'mcp' ? 100 : 120,
            );
          }
        previous = next;
      }
    }
  });
  it('reproduces scored pose shapes at their target closure and never mutates contracts', () => {
    for (const pose of Object.values(POSES)) {
      const before = JSON.stringify(pose);
      const angles = jointsFromClosure(
        Object.fromEntries(
          FINGERS.map((f) => [f, pose.closure[f] ?? 0]),
        ) as Record<(typeof FINGERS)[number], number>,
        pose,
      );
      for (const finger of FINGERS)
        if (pose.closure[finger] !== null)
          expect(angles[finger]).toEqual(pose.render[finger]);
      expect(JSON.stringify(pose)).toBe(before);
    }
  });
  it('clamps invalid sensor input and makes no fabricated thumb DIP', () => {
    const result = jointsFromClosure({
      thumb: 2,
      index: -1,
      middle: NaN,
      ring: Infinity,
      pinky: 1.1,
    });
    expect(result.thumb).toEqual({ mcp: 50, pip: 50, dip: 0 });
    expect(result.index.mcp).toBe(0);
    expect(result.middle.pip).toBe(0);
    expect(result.ring.dip).toBe(0);
    expect(result.pinky.dip).toBe(80);
  });
});
