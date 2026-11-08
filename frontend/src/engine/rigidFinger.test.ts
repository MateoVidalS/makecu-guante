import { describe, expect, it } from 'vitest';
import { GLOVE_FINGERS, closureFromPull, type Quint } from '../contracts/glove';
import { SERVO_PROFILES } from './assist';
import { Run } from './test/exerciseRun';

describe('resistance to opening (flexor tone)', () => {
  it.each(GLOVE_FINGERS)(
    'freezes a rigid %s within 200 ms plus one tick and lowers future speed',
    (finger) => {
      const r = new Run('open', { assist_max_s: 10, hold_s: 0.5 });
      const index = GLOVE_FINGERS.indexOf(finger);
      r.world.hand = [0, 0, 0, 0, 0];
      r.world.hand[index] = 1;
      r.until('ASSIST');
      for (let i = 0; i < 7; i++) r.step();
      r.world.ma =
        100 + Math.min(250, (SERVO_PROFILES[finger].stall_ma * 250) / 800) + 1;
      const at = r.world.now;
      for (let i = 0; i < 4; i++) r.step();
      expect(r.engine.state().phase).toBe('ASSIST');
      const out = r.step();
      expect(r.world.now - at).toBe(250);
      expect(out.events).toContainEqual({
        kind: 'resistance',
        finger,
        ma: r.world.ma,
      });
      expect(r.engine.state().phase).toBe('ASSIST_HOLD');
      expect(
        r
          .targets()
          .at(-1)!
          .f.every((v, i) => v <= r.world.tel.a[i]),
      ).toBe(true);
      expect(r.engine.therapy.speed(finger)).toBe(0.15);
      r.until('DONE');
      expect(r.events.filter((e) => e.kind === 'resistance')).toHaveLength(1);
    },
  );

  it('uses injected servo thresholds, ignores brief spikes and sustained load with opening progress', () => {
    const r = new Run(
      'open',
      { assist_max_s: 10 },
      { servoProfiles: { index: { stall_ma: 400 } } },
    );
    r.world.hand = [0, 1, 0, 0, 0];
    r.until('ASSIST');
    for (let i = 0; i < 7; i++) r.step();
    r.world.ma = 230;
    for (let i = 0; i < 5; i++) r.step();
    expect(r.events).toContainEqual({
      kind: 'resistance',
      finger: 'index',
      ma: 230,
    });
    const moving = new Run('open', { assist_max_s: 10 });
    moving.until('ASSIST');
    for (let i = 0; i < 7; i++) moving.step();
    moving.world.ma = 500;
    for (let i = 0; i < 20; i++) {
      moving.world.hand = moving.world.tel.a.map(closureFromPull) as Quint;
      moving.step();
    }
    expect(moving.events.some((e) => e.kind === 'resistance')).toBe(false);
  });
});
