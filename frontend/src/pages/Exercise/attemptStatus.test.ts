import { describe, expect, it } from 'vitest';
import type { AttemptResult } from '../../contracts/engine';
import { attemptStatus, liveStop, stopFor } from './attemptStatus';

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
  it('says "relax" during the release instead of flashing the instruction', () => {
    expect(attemptStatus('RELEASE', null, 3)).toMatchObject({
      title: 'Relax your hand',
      tone: 'neutral',
      done: false,
    });
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

describe('resistance stop (EX-07)', () => {
  const stop = { index: 3, finger: 'index' as const };
  const resisted = (over: Partial<AttemptResult> = {}) =>
    result({
      assisted: true,
      safety_events: [
        { source: 'resistance', t_rel: 6.9, finger: 'index', ma: 1037 },
      ],
      ...over,
    });
  it('replaces "Hold it" with the stop while the glove holds, then releases', () => {
    for (const phase of ['ASSIST', 'ASSIST_HOLD', 'RELEASE'] as const) {
      const status = attemptStatus(phase, null, 3, stop);
      expect(status).toEqual({
        title: 'Stopped — resistance in your index',
        tone: 'caution',
        done: false,
        label: 'Glove stopped',
        hint: 'The glove stopped pulling. Relax your hand.',
      });
      // Patient views never show current, and never "Hold it" or "helping".
      expect(JSON.stringify(status)).not.toMatch(/mA|Hold it|help/i);
    }
  });
  it('ignores a stop from another attempt or once a safety pause takes over', () => {
    expect(attemptStatus('ASSIST_HOLD', null, 4, stop)?.title).toBe('Hold it');
    expect(attemptStatus('PAUSED', null, 3, stop)).toBeNull();
    expect(attemptStatus('HOLD', null, 3, stop)?.title).toBe('Got it! Hold it');
  });
  it('does not claim the glove helped in the rest after a stop', () => {
    for (const r of [resisted(), resisted({ reached_final: true })])
      expect(attemptStatus('REST', r, 3)).toEqual({
        title: 'We stopped to keep your index safe',
        tone: 'caution',
        done: false,
        label: 'Rest a moment',
      });
    // The saved result speaks in REST, whatever the live stop says.
    expect(attemptStatus('REST', resisted(), 3, stop)?.title).toBe(
      'We stopped to keep your index safe',
    );
    // A safety pause keeps its own words.
    expect(
      attemptStatus('REST', resisted({ interrupted: true }), 3)?.title,
    ).toBe('Attempt paused');
    // A stop without a known finger still reads naturally.
    expect(
      attemptStatus(
        'REST',
        resisted({
          safety_events: [
            { source: 'resistance', t_rel: 1, finger: null, ma: 900 },
          ],
        }),
        3,
      )?.title,
    ).toBe('We stopped to keep your hand safe');
    // Other safety records (load shedding) are not a resistance stop.
    expect(
      attemptStatus(
        'REST',
        result({
          assisted: true,
          safety_events: [
            { source: 'load_shed', t_rel: 1, finger: 'ring', ma: 1800 },
          ],
        }),
        3,
      )?.title,
    ).toBe('The glove helped. Good effort');
  });
  it('marks only the resisting finger, only in its own attempt', () => {
    expect(liveStop(stop, 'ASSIST_HOLD', 3)).toBe(stop);
    expect(liveStop(stop, 'REST', 3)).toBeNull();
    expect(liveStop(stop, 'ATTEMPT', 4)).toBeNull();
    expect(stopFor(stop, 'index')).toBe('self');
    expect(stopFor(stop, 'middle')).toBe('other');
    expect(stopFor(null, 'index')).toBeNull();
  });
});
