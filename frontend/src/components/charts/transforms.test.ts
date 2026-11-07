import { describe, expect, it } from 'vitest';
import {
  assistSeries,
  decimate,
  phaseBands,
  resistanceSeries,
  toFingerSeries,
} from './transforms';
import type {
  AssistPoint,
  ResistancePoint,
  RomPoint,
} from '../../contracts/api';
import type { ExercisePhase } from '../../contracts/engine';
const timeline = [
  { id: 1, started_at: '2026-01-01T00:00:00Z', is_demo: true },
  { id: 2, started_at: '2026-01-02T00:00:00Z', is_demo: false },
  { id: 3, started_at: '2026-01-10T00:00:00Z', is_demo: false },
];
describe('history transforms', () => {
  it('sorts by true time, scales percentages, preserves zero, demo source and missing sessions', () => {
    const points: RomPoint[] = [
      {
        session_id: 3,
        started_at: timeline[2].started_at,
        is_demo: false,
        finger: 'index',
        pose: 'full_fist',
        active_max_mean: 0.8,
      },
      {
        session_id: 1,
        started_at: timeline[0].started_at,
        is_demo: true,
        finger: 'index',
        pose: 'full_fist',
        active_max_mean: 0,
      },
      {
        session_id: 2,
        started_at: timeline[1].started_at,
        is_demo: false,
        finger: 'thumb',
        pose: 'full_fist',
        active_max_mean: 0.5,
      },
    ];
    const before = structuredClone(points);
    const rows = toFingerSeries(points, 'index', timeline);
    expect(rows.map((r) => r.active)).toEqual([0, null, 80]);
    expect(toFingerSeries(points, 'index').map((r) => r.active)).toEqual([
      0,
      null,
      80,
    ]);
    expect(rows.map((r) => r.demo)).toEqual([true, false, false]);
    expect(rows[2].x - rows[1].x).toBe(8 * (rows[1].x - rows[0].x));
    expect(points).toEqual(before);
    expect(toFingerSeries([], 'index')).toEqual([]);
  });
  it('retains both assistance measures without treating missing as zero', () => {
    const points: AssistPoint[] = [
      {
        session_id: 1,
        started_at: timeline[0].started_at,
        is_demo: true,
        finger: 'middle',
        assist_needed_mean: 0,
        assisted_rate: 0.6,
      },
    ];
    expect(
      assistSeries(points, 'middle', timeline).map((r) => [r.needed, r.rate]),
    ).toEqual([
      [0, 60],
      [null, null],
      [null, null],
    ]);
  });
  it('preserves null sweeps and negative velocity dependence', () => {
    const points: ResistancePoint[] = [
      {
        evaluation_id: 1,
        started_at: timeline[0].started_at,
        is_demo: true,
        finger: 'thumb',
        slow: 140,
        fast: null,
        dependence: null,
      },
      {
        evaluation_id: 3,
        started_at: timeline[2].started_at,
        is_demo: false,
        finger: 'thumb',
        slow: 100,
        fast: 90,
        dependence: -10,
      },
    ];
    expect(
      resistanceSeries(points, 'thumb', timeline).map((r) => [
        r.slow,
        r.fast,
        r.dependence,
      ]),
    ).toEqual([
      [140, null, null],
      [null, null, null],
      [100, 90, -10],
    ]);
  });
});
describe('replay transforms', () => {
  it('uses the actual transition time for contiguous phase bands', () => {
    const phase: ExercisePhase[] = [
      'ATTEMPT',
      'ATTEMPT',
      'ASSIST',
      'ASSIST',
      'RELEASE',
    ];
    expect(phaseBands({ t: [0, 0.05, 0.1, 0.15, 0.2], phase })).toEqual([
      { phase: 'ATTEMPT', start: 0, end: 0.1 },
      { phase: 'ASSIST', start: 0.1, end: 0.2 },
      { phase: 'RELEASE', start: 0.2, end: 0.2 },
    ]);
    expect(phaseBands({ t: [], phase: [] })).toEqual([]);
  });
  it('keeps endpoints, current spikes, gaps, and phase transitions in long traces', () => {
    const data = Array.from({ length: 2000 }, (_, i) => ({
      t: i,
      current: i === 957 ? 900 : 100,
      closure: i === 500 ? null : 0.5,
      phase: i < 700 ? 'ATTEMPT' : 'ASSIST',
    }));
    const result = decimate(
      data,
      100,
      (p) => [p.current, p.closure],
      (a, b) => a.phase !== b.phase,
    );
    expect(result.length).toBeLessThan(120);
    expect(result[0]).toBe(data[0]);
    expect(result.at(-1)).toBe(data.at(-1));
    for (const i of [499, 500, 501, 699, 700, 957])
      expect(result).toContain(data[i]);
    expect(result.map((p) => p.t)).toEqual(
      [...result.map((p) => p.t)].sort((a, b) => a - b),
    );
    expect(decimate(data.slice(0, 2), 10, (p) => [p.current])).toEqual(
      data.slice(0, 2),
    );
    expect(() => decimate(data, 1, (p) => [p.current])).toThrow(RangeError);
  });
});
