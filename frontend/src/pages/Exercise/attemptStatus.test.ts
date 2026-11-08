import { describe, expect, it } from 'vitest';
import type { AttemptResult } from '../../contracts/engine';
import { attemptStatus } from './attemptStatus';

const result = (over: Partial<AttemptResult>) =>
  ({
    index: 3,
    interrupted: false,
    reached_active: false,
    reached_final: false,
    assisted: false,
    ...over,
  }) as AttemptResult;

describe('attempt status the patient sees', () => {
  it('says the pose was reached while holding', () => {
    expect(attemptStatus('HOLD', null, 3)).toMatchObject({
      title: 'Got it! Hold it',
      done: true,
    });
    // After the glove's help the pose may not have been reached: no "Got it".
    expect(attemptStatus('ASSIST_HOLD', null, 3)).toMatchObject({
      title: 'Hold it',
      tone: 'assist',
      done: false,
    });
  });
  it('tells how the attempt ended during the rest', () => {
    expect(
      attemptStatus(
        'REST',
        result({ reached_active: true, reached_final: true }),
        3,
      )?.title,
    ).toBe('You did it on your own!');
    expect(
      attemptStatus('REST', result({ assisted: true, reached_final: true }), 3)
        ?.title,
    ).toBe("Done, with the glove's help");
    expect(attemptStatus('REST', result({ assisted: true }), 3)?.done).toBe(
      false,
    );
    expect(attemptStatus('REST', result({}), 3)?.title).toBe(
      'Not this time. Good effort',
    );
    expect(attemptStatus('REST', result({ interrupted: true }), 3)?.title).toBe(
      'Attempt paused',
    );
  });
  it('never reports an older attempt and stays quiet while trying', () => {
    expect(
      attemptStatus('REST', result({ reached_active: true }), 4),
    ).toBeNull();
    expect(attemptStatus('ATTEMPT', null, 3)).toBeNull();
    expect(
      attemptStatus('PRESENT', result({ reached_active: true }), 3),
    ).toBeNull();
  });
});
