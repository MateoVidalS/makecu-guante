import { describe, expect, it } from 'vitest';
import { GLOVE_FINGERS, type Quint } from '../contracts/glove';
import { opensFinger, POSES, type PoseId } from '../contracts/poses';
import { Run } from './test/exerciseRun';

/** Highest pull the glove was ever asked for, per finger. */
function maxPull(run: Run): Quint {
  const max: Quint = [0, 0, 0, 0, 0];
  for (const t of run.targets())
    t.f.forEach((v, i) => {
      max[i] = Math.max(max[i], v);
    });
  return max;
}
const index = (finger: string) => GLOVE_FINGERS.indexOf(finger as never);

describe('finger by finger poses', () => {
  it.each([
    ['thumbs_up', ['thumb']],
    ['point', ['index']],
    ['peace', ['index', 'middle']],
    ['pinky_up', ['pinky']],
  ] as [PoseId, string[]][])(
    '%s raises %j and keeps the other fingers closed',
    (pose, raised) => {
      expect(POSES[pose].raise).toEqual(raised);
      for (const finger of GLOVE_FINGERS) {
        const target = POSES[pose].closure[finger];
        if (raised.includes(finger)) expect(target).toBe(0);
        else if (target !== null) expect(target).toBeGreaterThan(0.5);
        expect(opensFinger(POSES[pose], finger)).toBe(raised.includes(finger));
      }
    },
  );

  it('a correct point (index up, others closed) is reached without help', () => {
    const run = new Run('point');
    run.world.hand = [0.5, 0.05, 0.9, 0.9, 0.9];
    run.until('HOLD');
    run.until('REST');
    const [result] = run.results();
    expect(result.reached_active).toBe(true);
    expect(result.assisted).toBe(false);
  });

  it('when the index does not rise, the glove helps only the index', () => {
    const run = new Run('point');
    run.world.hand = [0.5, 0.9, 0.9, 0.9, 0.9];
    run.until('ASSIST');
    run.until('REST');
    const pull = maxPull(run);
    expect(pull[index('index')]).toBeGreaterThan(0.5);
    for (const finger of ['middle', 'ring', 'pinky'])
      expect(pull[index(finger)]).toBeLessThan(0.15);
    const [result] = run.results();
    expect(result.assisted).toBe(true);
    const metrics = Object.fromEntries(
      result.fingers.map((f) => [f.finger, f]),
    );
    expect(metrics.index.assist_needed).toBeGreaterThan(0.5);
    expect(metrics.middle.assist_needed).toBe(0);
  });

  it('never pulls on a finger that should stay closed, even when it is over-closed', () => {
    const run = new Run('point');
    run.world.hand = [0.5, 0.9, 1, 1, 1];
    run.until('ASSIST');
    run.until('REST');
    const pull = maxPull(run);
    for (const finger of ['middle', 'ring', 'pinky'])
      expect(pull[index(finger)]).toBeLessThan(0.15);
  });

  it('two fingers up helps index and middle, not ring or pinky', () => {
    const run = new Run('peace');
    run.world.hand = [0.5, 0.9, 0.9, 0.9, 0.9];
    run.until('ASSIST');
    run.until('REST');
    const pull = maxPull(run);
    expect(pull[index('index')]).toBeGreaterThan(0.5);
    expect(pull[index('middle')]).toBeGreaterThan(0.5);
    expect(pull[index('ring')]).toBeLessThan(0.15);
    expect(pull[index('pinky')]).toBeLessThan(0.15);
  });

  it('thumbs up helps only the thumb', () => {
    const run = new Run('thumbs_up');
    run.world.hand = [0.9, 0.9, 0.9, 0.9, 0.9];
    run.until('ASSIST');
    run.until('REST');
    const pull = maxPull(run);
    expect(pull[index('thumb')]).toBeGreaterThan(0.5);
    for (const finger of ['index', 'middle', 'ring', 'pinky'])
      expect(pull[index(finger)]).toBeLessThan(0.15);
  });

  it('a closed finger that opens by mistake is not reached, and the glove cannot close it', () => {
    const run = new Run('point');
    // Index up, but the middle finger also opened.
    run.world.hand = [0.5, 0.05, 0.1, 0.9, 0.9];
    run.until('DONE');
    const [result] = run.results();
    expect(result.reached_active).toBe(false);
    // Nothing needed opening, so there was no assist phase at all.
    expect(result.assisted).toBe(false);
    expect(
      run.events.some((e) => e.kind === 'phase' && e.phase === 'ASSIST'),
    ).toBe(false);
    expect(maxPull(run)[index('middle')]).toBeLessThan(0.15);
  });
});
