import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordLandmarks, type LandmarkCapture } from './recorder';

const setup = () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  let listener: ((capture: LandmarkCapture) => void) | undefined;
  const detach = vi.fn(() => {
    listener = undefined;
  });
  const source = {
    onLandmarks(cb: (capture: LandmarkCapture) => void) {
      listener = cb;
      return detach;
    },
  };
  return {
    source,
    detach,
    emit: (capture: LandmarkCapture) => listener?.(capture),
  };
};
const miss = (t: number): LandmarkCapture => ({
  t,
  result: { landmarks: [], worldLandmarks: [], handedness: [] },
});
afterEach(() => vi.useRealTimers());

describe('opt-in real landmark recording', () => {
  it('copies raw buffers, keeps missed detections, labels real setup and stops after 30s', async () => {
    const { source, emit, detach } = setup();
    const recorder = recordLandmarks(source, {
      pose: 'hook',
      affectedHand: 'left',
      glove: 'glove',
    });
    const frame = miss(0);
    frame.result.landmarks = [[{ x: 0.2, y: 0.3, z: 0, visibility: 0.8 }]];
    emit(frame);
    frame.result.landmarks[0][0].x = 0.9;
    emit(miss(34));
    await vi.advanceTimersByTimeAsync(30000);
    const recording = await recorder.finished;
    expect(recording).toMatchObject({
      pose: 'hook',
      affectedHand: 'left',
      glove: 'glove',
      durationMs: 30000,
    });
    expect(recording.source).toContain('not synthetic');
    expect(recording.requestedSetup).toContain('palm facing the laptop screen');
    expect(recording.frames).toHaveLength(2);
    expect(recording.frames[0].result.landmarks[0][0].x).toBe(0.2);
    expect(recording.frames[1].result.landmarks).toEqual([]);
    expect(detach).toHaveBeenCalledOnce();
    emit(miss(30001));
    expect(recorder.stop()).toBe(recording);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('supports early stop and ignores invalid/out-of-order samples', async () => {
    const { source, emit, detach } = setup();
    const recorder = recordLandmarks(source, {
      pose: 'pinch',
      affectedHand: 'right',
      glove: 'exposed-fingertips',
    });
    for (const t of [10, 10, 9, -1, NaN, 30001]) emit(miss(t));
    await vi.advanceTimersByTimeAsync(100);
    expect(recorder.stop().frames).toHaveLength(1);
    expect((await recorder.finished).durationMs).toBe(100);
    expect(detach).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds recording memory and rejects invalid duration', async () => {
    const { source, emit, detach } = setup();
    for (const durationMs of [0, 0.5, -1, 30001, NaN])
      expect(() =>
        recordLandmarks(source, {
          pose: 'open',
          affectedHand: 'right',
          glove: 'bare-hand',
          durationMs,
        }),
      ).toThrow();
    const recorder = recordLandmarks(source, {
      pose: 'open',
      affectedHand: 'right',
      glove: 'bare-hand',
    });
    for (let t = 0; t <= 1800; t++) emit(miss(t));
    expect((await recorder.finished).frames).toHaveLength(1800);
    expect(detach).toHaveBeenCalledOnce();
  });
});
