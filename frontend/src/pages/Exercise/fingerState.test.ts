import { describe, expect, it } from 'vitest';
import { liveFingerState } from './fingerState';

describe('individual finger feedback', () => {
  const sample = {
    phase: 'ASSIST' as const,
    target: 0,
    value: 0.5,
    best: 0.7,
    assisting: true,
  };
  it('tints unreached fingers, including ring and pinky, as helped', () => {
    expect(liveFingerState(sample)).toBe('assist');
  });
  it('keeps a reached finger green while others receive help', () => {
    expect(liveFingerState({ ...sample, value: 0.05 })).toBe('reached');
    expect(liveFingerState({ ...sample, best: 0.05 })).toBe('active');
  });
  it('leaves pinch-free fingers, missing tracking and rest neutral', () => {
    expect(liveFingerState({ ...sample, target: null })).toBe('idle');
    expect(liveFingerState({ ...sample, value: null })).toBe('idle');
    expect(liveFingerState({ ...sample, phase: 'REST' })).toBe('idle');
  });
  it('marks the finger the glove stopped for, and stops tinting the others as helped', () => {
    const held = { ...sample, phase: 'ASSIST_HOLD' as const };
    expect(liveFingerState({ ...held, stop: 'self' })).toBe('stopped');
    // Even when the camera loses it: the stop is known from the glove.
    expect(liveFingerState({ ...held, value: null, stop: 'self' })).toBe(
      'stopped',
    );
    expect(liveFingerState({ ...held, stop: 'other' })).toBe('idle');
    expect(liveFingerState({ ...held, value: 0.05, stop: 'other' })).toBe(
      'idle',
    );
    // Free fingers and the rest stay neutral.
    expect(liveFingerState({ ...held, target: null, stop: 'self' })).toBe(
      'idle',
    );
    expect(liveFingerState({ ...sample, phase: 'REST', stop: 'self' })).toBe(
      'idle',
    );
  });
  it('checks opening in the opposite direction', () => {
    expect(liveFingerState({ ...sample, target: 0, value: 0.05 })).toBe(
      'reached',
    );
    expect(liveFingerState({ ...sample, target: 0, value: 0.7 })).toBe(
      'assist',
    );
  });
});
