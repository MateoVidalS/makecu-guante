import { describe, expect, it } from 'vitest';
import { closureFromPull, type Quint } from '../contracts/glove';
import { Run } from './test/exerciseRun';

// Script exact governor deadlines separately from the O2 patient-model soak.
describe('sustained opening-load governor', () => {
  it('sheds load under flexor tone without pausing or reaching the firmware limit', () => {
    const r = new Run(
      'open',
      { assist_max_s: 15, hold_s: 5 },
      { currentLimitMa: 2200 },
    );
    let peak = 0;
    let recovered = false;
    for (let i = 0; i < 900 && r.engine.state().phase !== 'DONE'; i++) {
      r.world.hand = r.world.tel.a.map((a) =>
        Math.min(0.65, closureFromPull(a)),
      ) as Quint;
      r.world.ma = 100 + r.world.tel.a.reduce((sum, a) => sum + a * 580, 0);
      peak = Math.max(peak, r.world.ma);
      r.step();
      if (
        r
          .results()
          .some((a) => a.safety_events.some((e) => e.source === 'load_shed')) &&
        r.world.ma <= 1760
      )
        recovered = true;
    }
    expect(r.engine.state().phase).toBe('DONE');
    const sheds = r
      .results()[0]
      .safety_events.filter((e) => e.source === 'load_shed');
    expect(sheds.length).toBeGreaterThan(0);
    expect(peak).toBeLessThan(2200);
    expect(recovered).toBe(true);
    expect(
      r.events.some((e) => e.kind === 'safety' || e.kind === 'resistance'),
    ).toBe(false);
  });

  it.each(['ASSIST', 'ASSIST_HOLD'] as const)(
    'sheds the newest finger every 200 ms in %s without starting a queued finger',
    (phase) => {
      const r = new Run(
        'open',
        { assist_max_s: phase === 'ASSIST' ? 15 : 0.4, hold_s: 10 },
        { currentLimitMa: 1000 },
      );
      r.until(phase);
      // Model fingers which follow the motors (no command/vision stall gap).
      const step = () => {
        r.world.hand = r.world.tel.a.map(closureFromPull) as Quint;
        return r.step(50);
      };
      r.world.ma = 810;
      const at = r.world.now;
      const count = r.targets().length;
      for (let i = 0; i < 4; i++) step();
      // The first sample establishes the start of the 200 ms window.
      expect(r.events.some((e) => e.kind === 'safety')).toBe(false);
      step();
      expect(r.targets().length).toBeGreaterThan(count);
      const before = r.targets().at(-1)!.f;
      for (let i = 0; i < 4; i++) step();
      const after = r.targets().at(-1)!.f;
      expect(after.every((v, i) => v <= before[i])).toBe(true);
      r.accept(r.engine.stop(r.world.now));
      const sheds = r
        .results()[0]
        .safety_events.filter((e) => e.source === 'load_shed');
      expect(sheds.length).toBeGreaterThanOrEqual(2);
      expect(
        Date.parse(r.results()[0].started_at) + sheds[0].t_rel * 1000,
      ).toBeGreaterThanOrEqual(at + 200);
      expect(sheds[0].finger).toBe(phase === 'ASSIST' ? 'thumb' : 'middle');
      for (let i = 1; i < sheds.length; i++)
        expect(sheds[i].t_rel - sheds[i - 1].t_rel).toBeCloseTo(0.2);
      expect(r.engine.state().phase).toBe('DONE');
    },
  );

  it('ignores brief load spikes and uses the calibration limit when no firmware limit is supplied', () => {
    const r = new Run('open', { assist_max_s: 10 });
    r.until('ASSIST');
    r.world.ma = 721;
    for (let i = 0; i < 4; i++) r.step();
    r.world.ma = 100;
    r.step();
    r.accept(r.engine.stop(r.world.now));
    expect(
      r.results()[0].safety_events.filter((e) => e.source === 'load_shed'),
    ).toEqual([]);
  });
});

it('uses the calibration ceiling and resumes queued starts only after load recovers', () => {
  const r = new Run('open', { assist_max_s: 10 });
  r.until('ASSIST');
  r.world.ma = 721;
  for (let i = 0; i < 5; i++) r.step();
  expect(
    r
      .targets()
      .at(-1)!
      .f.filter((v, i) => v > r.world.tel.a[i]),
  ).toHaveLength(1);
  const before = r.targets().at(-1)!.f;
  r.world.ma = 720;
  r.step();
  const after = r.targets().at(-1)!.f;
  expect(after.some((v, i) => v > before[i])).toBe(true);
  r.accept(r.engine.stop(r.world.now));
  expect(r.results()[0].safety_events).toContainEqual(
    expect.objectContaining({ source: 'load_shed', ma: 721 }),
  );
});
