import { afterEach, describe, expect, it, vi } from 'vitest';
import { Color } from 'three';
import { POSES } from '../contracts/poses';
import { tokens } from '../styles/tokens';
import { createHandScene } from './scene';
import { createHandAnimator } from './animation';

const resources: ReturnType<typeof createHandScene>[] = [];
function setup() {
  const scene = createHandScene('right', tokens.light);
  resources.push(scene);
  return { scene, animation: createHandAnimator(scene, tokens.light) };
}
afterEach(() => {
  for (const scene of resources) scene.dispose();
  resources.length = 0;
});

describe('hand feedback', () => {
  it('tints only the three glove fingers, and keeps ring/pinky neutral', () => {
    const { scene, animation } = setup();
    animation.tick(POSES.open.render, () => 'assist', true, false, 1 / 60);
    expect(
      scene.fingers[0].color.equals(
        new Color(tokens.light.hand).lerp(new Color(tokens.light.assist), 0.55),
      ),
    ).toBe(true);
    expect(scene.fingers[3].color.equals(new Color(tokens.light.hand))).toBe(
      true,
    );
    expect(scene.fingers[4].color.equals(new Color(tokens.light.hand))).toBe(
      true,
    );
    expect(scene.ghost.opacity).toBe(0.35);
  });
  it('pulses for 400 ms once on reaching and fades the target during hold', () => {
    const { scene, animation } = setup();
    animation.tick(POSES.full_fist.render, () => 'reached', true, false, 0.2);
    expect(animation.rimIntensity).toBeCloseTo(2);
    expect(scene.ghost.opacity).toBeCloseTo(0.275);
    animation.tick(POSES.full_fist.render, () => 'reached', true, false, 0.2);
    expect(animation.rimIntensity).toBeCloseTo(0);
    expect(scene.target.visible).toBe(false);
    animation.tick(POSES.full_fist.render, () => 'reached', true, false, 1);
    expect(scene.ghost.opacity).toBe(0);
    animation.tick(POSES.full_fist.render, () => 'active', true, false, 1 / 60);
    expect(scene.target.visible).toBe(true);
    animation.tick(POSES.full_fist.render, () => 'reached', true, false, 0.2);
    expect(animation.rimIntensity).toBeCloseTo(2);
  });
  it('fades the last actual pose to 30% when tracking is lost, then recovers', () => {
    const { scene, animation } = setup();
    animation.tick(POSES.hook.render, () => 'active', true, true, 1 / 60);
    const previous = scene.actual.fingers.index.joints[1].quaternion.clone();
    animation.tick(null, () => 'active', true, false, 1 / 60);
    expect(animation.visibilityChanged).toBe(true);
    expect(scene.palm.opacity).toBeGreaterThan(0.3);
    for (let i = 0; i < 90; i++)
      animation.tick(null, () => 'active', true, false, 1 / 60);
    expect(scene.palm.opacity).toBeCloseTo(0.3);
    expect(
      scene.actual.fingers.index.joints[1].quaternion.equals(previous),
    ).toBe(true);
    animation.tick(POSES.open.render, () => 'idle', true, true, 1 / 60);
    expect(animation.visible).toBe(true);
    expect(scene.palm.opacity).toBe(1);
  });
  it('uses immediate state and joint changes without pulses in reduced motion', () => {
    const { scene, animation } = setup();
    animation.tick(POSES.tabletop.render, () => 'reached', true, true, 0.2);
    expect(animation.rimIntensity).toBe(0);
    expect(scene.ghost.opacity).toBe(0);
    expect(scene.actual.fingers.middle.joints[0].rotation.x).toBeCloseTo(
      Math.PI / 2,
    );
    animation.tick(null, () => 'idle', false, true, 1 / 60);
    expect(scene.palm.opacity).toBe(0.3);
    expect(scene.target.visible).toBe(false);
  });
  it('disposes all shared GPU resources once on unmount', () => {
    const { scene } = setup();
    const disposed = vi.fn();
    scene.palm.addEventListener('dispose', disposed);
    scene.dispose();
    expect(disposed).toHaveBeenCalledOnce();
    resources.pop();
  });
});
