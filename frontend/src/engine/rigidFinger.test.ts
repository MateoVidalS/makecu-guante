import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GLOVE_FINGERS, pullFromClosure } from '../contracts/glove';
import { simRun } from './test/simRun';

beforeEach(() => vi.spyOn(performance, 'now').mockReturnValue(0));
describe('rigid fingers resisting assisted opening in the O2 simulator', () => {
  it.each(GLOVE_FINGERS)(
    'freezes %s on resistance before the firmware hard cut',
    async (finger) => {
      const r = await simRun(
        finger === 'index' ? 'rigid_index' : 'moderate',
        [{ pose: 'open', reps: 1 }],
        2200,
      );
      if (finger !== 'index') r.world.controls.setRigid(finger, true);
      try {
        let frozenPull: number | null = null;
        let frozeAt = 0;
        const index = GLOVE_FINGERS.indexOf(finger);
        for (
          let i = 0;
          i < 2000 && !['DONE', 'PAUSED'].includes(r.engine.state().phase);
          i++
        ) {
          const out = r.step();
          if (out.events.some((e) => e.kind === 'resistance')) {
            frozenPull = r.world.firmware.goal[index];
            frozeAt = r.world.now;
            expect(r.world.servoPosition[index]).toBeLessThanOrEqual(
              pullFromClosure(r.world.patient.rigidFloor(finger)) + 1e-6,
            );
            expect(frozenPull).toBeLessThanOrEqual(
              r.world.firmware.position[index],
            );
          }
        }
        expect(r.engine.state().phase).toBe('DONE');
        expect(r.events).toContainEqual(
          expect.objectContaining({ kind: 'resistance', finger }),
        );
        expect(r.events.some((e) => e.kind === 'safety')).toBe(false);
        expect(r.engine.therapy.speed(finger)).toBe(0.15);
        const result = r.events.find((e) => e.kind === 'attempt_done');
        expect(result).toMatchObject({
          result: {
            assisted: true,
            safety_events: [
              expect.objectContaining({ source: 'resistance', finger }),
            ],
          },
        });
        expect(frozenPull).not.toBeNull();
        for (const { at, command } of r.commands)
          if (at >= frozeAt && command.t === 'target')
            expect(command.f[index]).toBeLessThanOrEqual(frozenPull!);
        expect(r.world.servoPosition[index]).toBe(0);
      } finally {
        r.world.stop();
      }
    },
  );
});
