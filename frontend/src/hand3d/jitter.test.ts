import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tokens } from '../styles/tokens';
import { FrameProcessor, type HandResult } from '../vision/frameProcessor';
import { jointAngles, type Landmark } from '../vision/flex';
import { createHandScene } from './scene';
import { createHandAnimator } from './animation';

/**
 * End-to-end jitter check: noisy MediaPipe-like landmarks -> FrameProcessor ->
 * hand animator at 60 fps -> rendered joint rotations. The camera runs at 30 fps.
 */
type Clip = { frames: { worldLandmarks: Landmark[]; landmarks: Landmark[] }[] };
const clip = (pose: string) =>
  JSON.parse(
    readFileSync(
      resolve('..', 'contracts', 'fixtures', `landmarks_${pose}.json`),
      'utf8',
    ),
  ) as Clip;
const OPEN = clip('open').frames[0];
const FIST = clip('full_fist').frames[0];
const HOOK = clip('hook').frames[0];

function rng(seed: number) {
  let a = seed;
  const uniform = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Box-Muller normal noise.
  return () =>
    Math.sqrt(-2 * Math.log(uniform() || 1e-12)) *
    Math.cos(2 * Math.PI * uniform());
}
/** ~1.5 mm per-axis noise: a realistic MediaPipe world-landmark tremor on a still hand. */
const NOISE_M = 0.0015;
function noisy(frame: Clip['frames'][number], gauss: () => number): HandResult {
  const point = ([x, y, z]: Landmark, sigma: number) => ({
    x: x + gauss() * sigma,
    y: y + gauss() * sigma,
    z: z + gauss() * sigma,
    visibility: 1,
  });
  return {
    landmarks: [frame.landmarks.map((p) => point(p, 0))],
    worldLandmarks: [frame.worldLandmarks.map((p) => point(p, NOISE_M))],
    handedness: [
      [{ categoryName: 'Right', score: 0.95, displayName: '', index: 0 }],
    ],
  };
}
const scenes: ReturnType<typeof createHandScene>[] = [];
afterEach(() => {
  scenes.forEach((s) => s.dispose());
  scenes.length = 0;
});
const LONG = ['index', 'middle', 'ring', 'pinky'] as const;
/** Rendered flexion in degrees for each long-finger joint. */
function rendered(scene: ReturnType<typeof createHandScene>): number[] {
  return LONG.flatMap((finger) =>
    scene.actual.fingers[finger].joints.map(
      (joint) =>
        (2 * Math.acos(Math.min(1, Math.abs(joint.quaternion.w))) * 180) /
        Math.PI,
    ),
  );
}
/** Runs a 60 fps render loop fed by a 30 fps camera; returns per-render samples. */
function run(seconds: number, pose: (t: number) => Clip['frames'][number]) {
  const scene = createHandScene('right', tokens.light);
  scenes.push(scene);
  const animator = createHandAnimator(scene, tokens.light);
  const processor = new FrameProcessor();
  const gauss = rng(7);
  const samples: { t: number; angles: number[] }[] = [];
  const raw: { t: number; angles: number[] }[] = [];
  let latest = null as ReturnType<FrameProcessor['process']>['joints'];
  let nextCamera = 0;
  const dt = 1000 / 60;
  for (let t = 0; t <= seconds * 1000; t += dt) {
    while (nextCamera <= t) {
      const input = noisy(pose(nextCamera), gauss);
      const angles = jointAngles(
        input.worldLandmarks[0].map((p): Landmark => [p.x, p.y, p.z]),
      );
      raw.push({
        t: nextCamera,
        angles: LONG.flatMap((f) => [
          angles[f].mcp,
          angles[f].pip,
          angles[f].dip,
        ]),
      });
      latest = processor.process(input, nextCamera, 'right').joints;
      nextCamera += 1000 / 30;
    }
    animator.tick(latest, () => 'active', true, false, dt / 1000);
    samples.push({ t, angles: rendered(scene) });
  }
  return Object.assign(samples, { raw });
}
const std = (values: number[]) => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length,
  );
};
function jitter(series: { t: number; angles: number[] }[]) {
  const joints = series[0].angles.length;
  let deviation = 0,
    motion = 0;
  for (let j = 0; j < joints; j++) {
    const values = series.map((s) => s.angles[j]);
    deviation += std(values);
    let step = 0;
    for (let i = 1; i < values.length; i++)
      step += Math.abs(values[i] - values[i - 1]);
    motion += step / (values.length - 1);
  }
  return { std: deviation / joints, perFrame: motion / joints };
}
/**
 * Mean std-dev and mean frame-to-frame motion (degrees) of the 12 long-finger
 * joints while the hand is held still, for the raw input and the rendered mesh.
 */
export function measureStillJitter(pose: 'open' | 'hook' = 'hook') {
  const samples = run(5, () => (pose === 'open' ? OPEN : HOOK));
  return {
    input: jitter(samples.raw.filter((s) => s.t >= 1000)),
    rendered: jitter(samples.filter((s) => s.t >= 1000)),
  };
}
/** Milliseconds for the rendered finger flexion sum to cover 90% of an open->fist step. */
export function measureStepSettle() {
  const STEP_AT = 1000;
  const samples = run(2.5, (t) => (t < STEP_AT ? OPEN : FIST));
  const total = (s: { angles: number[] }) => s.angles.reduce((a, b) => a + b);
  const before = total(samples.find((s) => s.t >= STEP_AT - 20)!);
  const after =
    samples.filter((s) => s.t >= 2000).reduce((a, s) => a + total(s), 0) /
    samples.filter((s) => s.t >= 2000).length;
  const reached = (fraction: number) =>
    samples.find(
      (s) => s.t >= STEP_AT && total(s) - before >= fraction * (after - before),
    )!.t - STEP_AT;
  return { t90: reached(0.9), t95: reached(0.95), span: after - before };
}

describe('virtual hand jitter', () => {
  it.each(['hook', 'open'] as const)(
    'keeps a still, noisy %s hand visually steady',
    (pose) => {
      const { input, rendered } = measureStillJitter(pose);
      console.info(
        `[jitter] still ${pose}: input std ${input.std.toFixed(2)} deg / ${input.perFrame.toFixed(2)} deg per camera frame; rendered std ${rendered.std.toFixed(2)} deg / ${rendered.perFrame.toFixed(3)} deg per render frame`,
      );
      expect(rendered.std).toBeLessThan(input.std / 3);
      expect(rendered.perFrame).toBeLessThan(input.perFrame / 20);
    },
  );
  it('still follows a real open-to-fist step within about 200 ms', () => {
    const step = measureStepSettle();
    console.info(
      `[jitter] step: 90% in ${step.t90.toFixed(0)} ms, 95% in ${step.t95.toFixed(0)} ms (span ${step.span.toFixed(0)} deg)`,
    );
    expect(step.span).toBeGreaterThan(500);
    expect(step.t90).toBeLessThanOrEqual(200);
    expect(step.t95).toBeLessThanOrEqual(260);
  });
});
