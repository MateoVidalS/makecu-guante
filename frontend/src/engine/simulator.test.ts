import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OPEN_ASSIST_PLAN } from '../contracts/poses';
import { simRun } from './test/simRun';

beforeEach(() => vi.spyOn(performance, 'now').mockReturnValue(0));
describe('opening assistance with the O2 patient model', () => {
  it.each(['mild', 'moderate', 'spastic'] as const)(
    'completes 10 attempts for %s below 2.2 A with at most three winding servos',
    async (preset) => {
      const r = await simRun(preset, OPEN_ASSIST_PLAN);
      let peak = 0;
      let peakMoving = 0;
      const unsubscribe = r.world.ticks.subscribe(() => {
        peak = Math.max(peak, r.world.power.demandMa);
        if (r.world.firmware.mode !== 'target') return;
        const moving = r.world.firmware.position.filter(
          (a, i) => r.world.firmware.goal[i] > a + 1e-6,
        ).length;
        peakMoving = Math.max(peakMoving, moving);
        expect(moving).toBeLessThanOrEqual(3);
      });
      try {
        for (
          let i = 0;
          i < 20000 && !['DONE', 'PAUSED'].includes(r.engine.state().phase);
          i++
        )
          r.step();
        expect(r.engine.state().phase).toBe('DONE');
        const attempts = r.events.flatMap((e) =>
          e.kind === 'attempt_done' ? [e.result] : [],
        );
        expect(attempts).toHaveLength(10);
        expect(
          attempts
            .filter((a) => a.pose === 'full_fist')
            .every((a) => !a.assisted),
        ).toBe(true);
        expect(
          attempts.filter((a) => a.pose === 'open').every((a) => a.assisted),
        ).toBe(true);
        expect(
          r.events.some((e) => e.kind === 'safety' || e.kind === 'resistance'),
        ).toBe(false);
        expect(peak).toBeLessThan(2200);
        expect(r.world.firmware.position).toEqual([0, 0, 0, 0, 0]);
        expect(peakMoving).toBe(3);
        for (const { command } of r.commands)
          if (command.t === 'target')
            expect(command.f.every((v) => v <= 0.95)).toBe(true);
      } finally {
        unsubscribe();
        r.world.stop();
      }
    },
  );
});

it('sheds sustained spastic load at the calibrated opening cap while preserving firmware headroom', async () => {
  const r = await simRun('spastic', [{ pose: 'open', reps: 1 }], 2200, {
    tolerance: 0,
    hold_s: 5,
  });
  let peak = 0;
  const unsubscribe = r.world.ticks.subscribe(() => {
    peak = Math.max(peak, r.world.power.demandMa);
  });
  try {
    for (
      let i = 0;
      i < 2000 && !['DONE', 'PAUSED'].includes(r.engine.state().phase);
      i++
    )
      r.step();
    expect(r.engine.state().phase).toBe('DONE');
    const result = r.events.find((e) => e.kind === 'attempt_done');
    expect(result).toMatchObject({
      result: {
        safety_events: expect.arrayContaining([
          expect.objectContaining({ source: 'load_shed' }),
        ]),
      },
    });
    expect(peak).toBeLessThan(2200);
    expect(
      r.events.some((e) => e.kind === 'safety' || e.kind === 'resistance'),
    ).toBe(false);
  } finally {
    unsubscribe();
    r.world.stop();
  }
});
