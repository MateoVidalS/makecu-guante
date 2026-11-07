import { describe, expect, it } from 'vitest';
import { POSES } from '../contracts/poses';
import { createJointSmoother, HAND_DAMPING } from './smoothing';

describe('render-side joint damping', () => {
  it('moves the same distance per second regardless of frame rate', () => {
    const reached = (fps: number) => {
      const smoother = createJointSmoother();
      smoother.step(POSES.open.render, 0);
      for (let i = 0; i < fps / 10; i++)
        smoother.step(POSES.full_fist.render, 1 / fps);
      return smoother.value.index.pip;
    };
    const at60 = reached(60);
    expect(reached(30)).toBeCloseTo(at60, 6);
    expect(reached(120)).toBeCloseTo(at60, 6);
    // 100 ms at rate 28 covers 1 - e^-2.8, about 94% of the step.
    expect(at60 / POSES.full_fist.render.index.pip).toBeCloseTo(
      1 - Math.exp(-0.1 * HAND_DAMPING.rate),
      6,
    );
  });
  it('ignores sub-degree changes but follows real ones', () => {
    const smoother = createJointSmoother();
    const pose = structuredClone(POSES.hook.render);
    smoother.step(pose, 0);
    const start = smoother.value.index.pip;
    for (let i = 0; i < 60; i++) {
      pose.index.pip = POSES.hook.render.index.pip + (i % 2 ? 0.8 : -0.8);
      smoother.step(pose, 1 / 60);
    }
    expect(smoother.value.index.pip).toBe(start);
    pose.index.pip = POSES.hook.render.index.pip + 20;
    for (let i = 0; i < 30; i++) smoother.step(pose, 1 / 60);
    expect(smoother.value.index.pip).toBeCloseTo(pose.index.pip, 1);
  });
  it('snaps immediately for reduced motion and skips invalid values', () => {
    const smoother = createJointSmoother();
    smoother.step(POSES.open.render, 1 / 60);
    smoother.step(POSES.tabletop.render, 1 / 60, true);
    expect(smoother.value.middle.mcp).toBe(POSES.tabletop.render.middle.mcp);
    const broken = structuredClone(POSES.tabletop.render);
    broken.middle.mcp = NaN;
    smoother.step(broken, 1 / 60);
    expect(smoother.value.middle.mcp).toBe(POSES.tabletop.render.middle.mcp);
  });
});
