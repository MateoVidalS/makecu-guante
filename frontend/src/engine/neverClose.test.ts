import { describe, expect, it } from 'vitest';
import { GLOVE_FINGERS, pullFromClosure, type Quint } from '../contracts/glove';
import { opensFinger, POSES, type PoseId } from '../contracts/poses';
import { Run } from './test/exerciseRun';

const HANDS: Quint[] = [
  [0.95, 0.95, 0.95, 0.95, 0.95], // fist
  [0.05, 0.05, 0.05, 0.05, 0.05], // open
  [0.6, 0.6, 0.6, 0.6, 0.6], // half
  [0.2, 0.9, 0.3, 0.8, 0.5], // mixed
];

describe('the glove only helps open, never close', () => {
  for (const pose of Object.keys(POSES) as PoseId[])
    for (const hand of HANDS)
      it(`${pose} with hand ${hand.join('/')}: no pull past where a non-opening finger already is`, () => {
        const run = new Run(pose);
        run.world.hand = [...hand] as Quint;
        run.until('DONE', 20000);
        for (const out of run.outputs)
          for (const c of out.commands) {
            if (c.t !== 'target' && c.t !== 'follow') continue;
            GLOVE_FINGERS.forEach((finger, i) => {
              if (opensFinger(POSES[pose], finger)) return;
              // Pull 0 = slack. A finger that must not open may at most be followed: its
              // thread never pulls past the finger's own position (no closing either way).
              expect(c.f[i]).toBeLessThanOrEqual(
                pullFromClosure(hand[i]) + 1e-6,
              );
            });
          }
      });
});
