import { describe, expect, it } from 'vitest';
import type { AttemptResult } from '../../contracts/engine';
import { tickFor } from './SuccessTick';

const result = (over: Partial<AttemptResult>) =>
  ({
    index: 2,
    interrupted: false,
    reached_active: false,
    reached_final: false,
    assisted: false,
    ...over,
  }) as AttemptResult;

describe('success tick', () => {
  it('appears the moment a held pose is released (reached on your own)', () => {
    expect(tickFor('HOLD', 'RELEASE', null, 2)).toBe('own');
  });
  it('appears when a glove-helped attempt ended reached', () => {
    expect(
      tickFor(
        'RELEASE',
        'REST',
        result({ assisted: true, reached_final: true }),
        2,
      ),
    ).toBe('helped');
  });
  it('does not appear while reaching, holding, or after a miss', () => {
    expect(tickFor('ATTEMPT', 'HOLD', null, 2)).toBeNull();
    expect(tickFor('ASSIST_HOLD', 'RELEASE', null, 2)).toBeNull();
    expect(tickFor('RELEASE', 'REST', result({}), 2)).toBeNull();
    expect(
      tickFor('RELEASE', 'REST', result({ assisted: true }), 2),
    ).toBeNull();
    // An older attempt's result never triggers it.
    expect(
      tickFor('RELEASE', 'REST', result({ reached_active: true, index: 1 }), 2),
    ).toBeNull();
  });
});
