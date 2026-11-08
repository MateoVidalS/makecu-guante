import { expect, it } from 'vitest';
import type { PoseId } from '../contracts/poses';
import { Run } from './test/exerciseRun';

it('announces each new pose with its own name, never the previous pose', () => {
  const plan = (
    ['full_fist', 'open', 'point', 'full_fist', 'open'] as PoseId[]
  ).map((pose) => ({ pose, reps: 1 }));
  const run = new Run('full_fist', {}, {}, plan);
  run.world.hand = [0.6, 0.6, 0.6, 0.6, 0.6];
  run.until('DONE', 20000);
  const presents = run.events.flatMap((e) =>
    e.kind === 'phase' && e.phase === 'PRESENT' ? [e] : [],
  );
  expect(presents.map((e) => e.pose)).toEqual(plan.map((p) => p.pose));
  // Every phase event of an attempt names that attempt's pose.
  for (const e of run.events)
    if (e.kind === 'phase' && e.phase !== 'DONE')
      expect(e.pose).toBe(plan[e.index].pose);
});
