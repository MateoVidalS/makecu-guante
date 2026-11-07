import { describe, expect, it } from 'vitest';
import type { GloveTelemetry } from '../../contracts/glove';
import { motorState } from './GloveMotors';

const tel = (over: Partial<GloveTelemetry>): GloveTelemetry => ({
  t: 0,
  ms: 0,
  a: [0, 0, 0, 0, 0],
  ma: 0,
  st: 'run',
  md: 'none',
  tg: [0, 0, 0, 0, 0],
  ...over,
});

describe('motorState', () => {
  it('is off without telemetry and stopped on a firmware fault', () => {
    expect(motorState(null, 0)).toBe('off');
    expect(motorState(tel({ st: 'fault', md: 'target' }), 1)).toBe('stopped');
  });
  it('marks only the motors still pulling toward their goal as helping', () => {
    const t = tel({
      md: 'target',
      a: [0.2, 0.5, 0.9, 0, 0.6],
      tg: [0.6, 0.5, 0.4, 0, 0.6],
    });
    expect([0, 1, 2, 3, 4].map((i) => motorState(t, i))).toEqual([
      'pulling',
      'holding',
      'releasing',
      'idle',
      'holding',
    ]);
  });
  it('shows follow mode as following, never as helping', () => {
    const t = tel({ md: 'follow', a: [0.3, 0, 0, 0, 0] });
    expect(motorState(t, 0)).toBe('following');
    expect(motorState(t, 1)).toBe('idle');
  });
});
