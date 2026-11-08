import { describe, expect, it, vi } from 'vitest';
import { closureFromPull, type Quint } from '../contracts/glove';
import { Run } from './test/exerciseRun';
import { simRun } from './test/simRun';

const EPSILON = 1e-6;

describe('assisted target hysteresis', () => {
  it('holds every started moderate finger for two seconds without releasing or pulling it again after arrival', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const r = await simRun('moderate', [{ pose: 'open', reps: 1 }]);
    try {
      for (let i = 0; i < 2000 && r.engine.state().phase !== 'ASSIST_HOLD'; i++)
        r.step();
      expect(r.engine.state().phase).toBe('ASSIST_HOLD');
      expect(r.events).toContainEqual(
        expect.objectContaining({ kind: 'reached', assisted: true }),
      );
      const started = new Set(
        r.commands.flatMap(({ command, position }) =>
          command.t === 'target'
            ? command.f.flatMap((value, i) =>
                value > position[i] + EPSILON ? [i] : [],
              )
            : [],
        ),
      );
      expect(started.size).toBe(5);
      const arrived = new Set<number>();
      let previous = [...r.world.firmware.position];
      const holdAt = r.world.now;
      while (r.engine.state().phase === 'ASSIST_HOLD') {
        for (const i of started)
          if (
            Math.abs(r.world.firmware.position[i] - r.world.firmware.goal[i]) <=
            EPSILON
          )
            arrived.add(i);
        const before = r.commands.length;
        r.step();
        for (const i of started)
          expect(r.world.firmware.position[i]).toBeGreaterThanOrEqual(
            previous[i] - EPSILON,
          );
        for (const { command, position } of r.commands.slice(before))
          if (command.t === 'target')
            for (const i of arrived)
              expect(command.f[i]).toBeLessThanOrEqual(position[i] + EPSILON);
        previous = [...r.world.firmware.position];
        expect(r.world.now - holdAt).toBeLessThanOrEqual(2000);
      }
      expect(r.world.now - holdAt).toBe(2000);
      expect(arrived.size).toBe(5);
      expect(r.engine.state().phase).toBe('RELEASE');
      expect(
        r.events.some(
          (event) => event.kind === 'safety' || event.kind === 'resistance',
        ),
      ).toBe(false);
    } finally {
      r.world.stop();
    }
  });

  it('sends no repeating targets during hold with vision noise of plus or minus 0.03 around tolerance', () => {
    const r = new Run('open', { attempt_s: 0.1, assist_max_s: 15, hold_s: 2 });
    r.until('ASSIST_HOLD');
    expect(r.world.tel.a.every((value) => Math.abs(value - 0.95) <= 0.02)).toBe(
      true,
    );
    const before = r.targets().length;
    for (let i = 0; i < 100; i++) {
      r.world.hand = Array(5).fill(i % 2 ? 0.13 : 0.07) as Quint;
      r.step(20);
    }
    expect(r.targets().length - before).toBe(0);
    expect(r.engine.state().phase).toBe('RELEASE');
  });

  it('still pays out a never-started patient-reached finger when the patient closes during hold', () => {
    const r = new Run('open', { attempt_s: 0.1, hold_s: 2, assist_max_s: 15 });
    r.world.hand = [0.05, 0.8, 0.8, 0.8, 0.8];
    for (let i = 0; i < 2000 && r.engine.state().phase !== 'ASSIST_HOLD'; i++) {
      if (r.engine.hasAssistance())
        r.world.hand = [
          0.05,
          ...r.world.tel.a.slice(1).map(closureFromPull),
        ] as Quint;
      r.step();
    }
    expect(r.engine.state().phase).toBe('ASSIST_HOLD');
    expect(r.targets().every((command) => command.f[0] < 0.95)).toBe(true);
    let previous = r.world.tel.tg![0];
    for (const closure of [0.85, 0.9, 0.95]) {
      r.world.hand[0] = closure;
      const out = r.step();
      const command = out.commands.find((item) => item.t === 'target');
      expect(command?.t).toBe('target');
      if (command?.t !== 'target')
        throw new Error('Expected safe payout target');
      expect(command.f[0]).toBeLessThan(previous);
      expect(command.f[0]).toBeLessThanOrEqual(r.world.tel.a[0]);
      for (const i of [1, 2, 3, 4]) expect(command.f[i]).toBe(0.95);
      previous = command.f[0];
    }
    expect(previous).toBe(0);
  });
});
