import { expect, it } from 'vitest';
import { DEFAULT_PLAN } from '../../contracts/poses';
import { exerciseProgress, evaluationProgress } from './SessionProgress';

it('counts plan poses separately from attempts throughout tendon glides', () => {
  for (let index = 0; index < 15; index++) {
    const rep = (index % 3) + 1;
    expect(exerciseProgress(DEFAULT_PLAN, index, rep)).toBe(
      `Pose ${Math.floor(index / 3) + 1} of 5 · Rep ${rep} of 3`,
    );
  }
});
it('uses each selected pose repetition count, including repeated pose entries', () => {
  const plan = [
    { pose: 'hook' as const, reps: 2 },
    { pose: 'hook' as const, reps: 1 },
  ];
  expect(exerciseProgress(plan, 1, 2)).toBe('Pose 1 of 2 · Rep 2 of 2');
  expect(exerciseProgress(plan, 2, 1)).toBe('Pose 2 of 2 · Rep 1 of 1');
});
it('counts evaluation sweeps from the selected fingers', () => {
  expect(evaluationProgress(['index', 'pinky'], 'pinky', 'slow', 'sweep')).toBe(
    'Pinky · slow (3 of 4)',
  );
  expect(evaluationProgress(['index', 'pinky'], 'pinky', 'fast', 'sweep')).toBe(
    'Pinky · fast (4 of 4)',
  );
});
