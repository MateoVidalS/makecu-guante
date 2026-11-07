import { describe, expect, it } from 'vitest';
import { AttemptMetrics, summarizeSession, TraceBuilder } from './metrics';
import { POSES } from '../contracts/poses';
import { FakeWorld } from './test/fakeWorld';

describe('metrics (06-session §4)', () => {
  it('decimates to 20 Hz without applying future inputs to old samples', () => {
    const w = new FakeWorld();
    const trace = new TraceBuilder(0);
    trace.sample(w.step(0), 'ATTEMPT');
    w.hand = [0.5, 0.5, 0.5, 0.5, 0.5];
    w.ma = 300;
    trace.sample(w.step(33), 'ATTEMPT');
    w.hand = [1, 1, 1, 1, 1];
    w.ma = 500;
    trace.sample(w.step(33), 'HOLD');
    expect(trace.trace.t).toEqual([0, 0.05]);
    expect(trace.trace.closure.index).toEqual([0, 0.5]);
    expect(trace.trace.ma).toEqual([100, 300]);
    expect(trace.trace.phase).toEqual(['ATTEMPT', 'ATTEMPT']);
  });
  it('uses active minima for open, holds final through release, and excludes free fingers', () => {
    const w = new FakeWorld();
    const m = new AttemptMetrics(POSES.open, 1, 0, 0);
    w.hand = [0.8, 0.7, 0.6, 0.6, 0.6];
    m.observe(w.step(0), 'ATTEMPT');
    w.hand = [0.1, 0.2, 0.3, 0.3, 0.3];
    m.observe(w.step(), 'ATTEMPT');
    w.hand = [0.4, 0.4, 0.4, 0.4, 0.4];
    m.observe(w.step(), 'HOLD');
    w.hand = [0, 0, 0, 0, 0];
    m.observe(w.step(), 'RELEASE');
    const result = m.finish(w.now);
    expect(result.active_ratio).toBeCloseTo(0.76);
    expect(result.fingers[1]).toMatchObject({
      active_max: 0.2,
      assist_needed: 0.2,
      final: 0.4,
    });
    expect(result.fingers[3]).toMatchObject({
      scored: true,
      active_max: 0.3,
      assist_needed: 0.3,
    });
    expect(result.current_mean_ma).toBeNull();
    const hook = new AttemptMetrics(POSES.hook, 1, 1, w.now);
    hook.observe(w.step(), 'ATTEMPT');
    const h = hook.finish(w.now);
    expect(h.fingers[0].scored).toBe(false);
    expect(h.active_ratio).toBeCloseTo(0);
    expect(summarizeSession([result, h])).toMatchObject({
      attempts: 2,
      previous: null,
      per_pose: [{ reps: 1 }, { reps: 1 }],
    });
    expect(summarizeSession([]).active_ratio_mean).toBe(0);
  });
  it('weights unique telemetry samples only during assist and assist hold', () => {
    const w = new FakeWorld();
    const m = new AttemptMetrics(POSES.hook, 1, 0, 0);
    const input = w.step(0);
    m.observe(input, 'ASSIST');
    m.observe(input, 'ASSIST');
    w.ma = 300;
    m.observe(w.step(), 'ASSIST_HOLD');
    w.ma = 900;
    m.observe(w.step(), 'RELEASE');
    expect(m.finish(w.now)).toMatchObject({
      current_peak_ma: 300,
      current_mean_ma: 200,
    });
  });
});

it('marks held vision samples unknown after the frame expires', () => {
  const w = new FakeWorld();
  const t = new TraceBuilder(0);
  t.sample(w.step(0), 'ATTEMPT');
  t.sample(w.step(500), 'ATTEMPT');
  expect(t.trace.closure.index.slice(0, 7)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  expect(t.trace.closure.index.slice(7, 10)).toEqual([null, null, null]);
  expect(t.trace.closure.index[10]).toBe(0);
});

it('includes independent ring/pinky values in ratios, traces, and session summaries', () => {
  const w = new FakeWorld();
  const m = new AttemptMetrics(POSES.straight_fist, 1, 0, 0);
  w.hand = [0.5, 0.7, 0.7, 0.35, 0.14];
  m.observe(w.step(0), 'ATTEMPT');
  const result = m.finish(0);
  expect(result.active_ratio).toBeCloseTo(0.74);
  expect(result.fingers[3]).toMatchObject({
    finger: 'ring',
    scored: true,
    active_max: 0.35,
    assist_needed: 0.35,
  });
  expect(result.fingers[4].assist_needed).toBeCloseTo(0.56);
  expect(result.trace.closure.ring).toEqual([0.35]);
  expect(result.trace.closure.pinky).toEqual([0.14]);
  expect(summarizeSession([result]).per_finger.slice(3)).toEqual([
    { finger: 'ring', active_max_mean: 0.35, assist_needed_mean: 0.35 },
    {
      finger: 'pinky',
      active_max_mean: 0.14,
      assist_needed_mean: result.fingers[4].assist_needed,
    },
  ]);
});
