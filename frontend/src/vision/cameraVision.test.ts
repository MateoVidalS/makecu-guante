import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  HandLandmarker,
  HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import open from '../../../contracts/fixtures/landmarks_open.json';
import { CameraVision } from './cameraVision';
const mp = vi.hoisted(() => ({
  create: vi.fn(),
  files: vi.fn(async () => ({})),
}));
vi.mock('@mediapipe/tasks-vision', () => ({
  HandLandmarker: { createFromOptions: mp.create },
  FilesetResolver: { forVisionTasks: mp.files },
}));
const points = (values: number[][]) =>
  values.map(([x, y, z]) => ({ x, y, z, visibility: 1 }));
const result: HandLandmarkerResult = {
  landmarks: [points(open.frames[0].landmarks)],
  worldLandmarks: [points(open.frames[0].worldLandmarks)],
  handedness: [
    [{ categoryName: 'Right', score: 0.95, displayName: '', index: 0 }],
  ],
  handednesses: [],
};
Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', {
  configurable: true,
  value: () => 0,
});
Object.defineProperty(HTMLVideoElement.prototype, 'cancelVideoFrameCallback', {
  configurable: true,
  value: () => {},
});
let source: CameraVision;
let stop: ReturnType<typeof vi.fn>,
  detect: ReturnType<typeof vi.fn>,
  close: ReturnType<typeof vi.fn>;
let callbacks: Map<number, VideoFrameRequestCallback>, callbackId: number;
let getUserMedia: ReturnType<typeof vi.fn>, track: MediaStreamTrack;
let model: HandLandmarker;
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
async function frame(t: number, mediaTime = t / 1000) {
  vi.setSystemTime(t);
  const [id, cb] = [...callbacks.entries()][0];
  callbacks.delete(id);
  cb(performance.now(), {
    mediaTime,
    captureTime: performance.now() - 5,
    presentationTime: performance.now() - 2,
  } as VideoFrameCallbackMetadata);
  await flush();
}
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setInterval', 'clearInterval', 'performance', 'Date'],
  });
  localStorage.clear();
  callbacks = new Map();
  callbackId = 0;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4);
  vi.spyOn(
    HTMLVideoElement.prototype,
    'requestVideoFrameCallback',
  ).mockImplementation((cb) => {
    callbacks.set(++callbackId, cb);
    return callbackId;
  });
  vi.spyOn(
    HTMLVideoElement.prototype,
    'cancelVideoFrameCallback',
  ).mockImplementation((id) => {
    callbacks.delete(id);
  });
  stop = vi.fn();
  track = Object.assign(new EventTarget(), {
    stop,
  }) as unknown as MediaStreamTrack;
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia,
      enumerateDevices: vi.fn(async () => [
        { kind: 'videoinput', deviceId: 'camera-1' },
        { kind: 'audioinput' },
      ]),
    },
  });
  detect = vi.fn(() => result);
  close = vi.fn();
  model = { detectForVideo: detect, close } as unknown as HandLandmarker;
  mp.create.mockReset().mockResolvedValue(model);
  mp.files.mockClear();
  source = new CameraVision();
});
afterEach(() => {
  source.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('CameraVision lifecycle', () => {
  it('keeps the camera running when a preview removes the video from the page', async () => {
    await source.start({ affectedHand: 'right' });
    const video = source.videoElement()!;
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play.mockClear();
    // Browsers pause a media element removed from the document (a preview unmounting).
    video.dispatchEvent(new Event('pause'));
    expect(play).toHaveBeenCalledTimes(1);
    // Stopping the camera pauses it on purpose and must not restart it.
    play.mockClear();
    source.stop();
    video.dispatchEvent(new Event('pause'));
    expect(play).not.toHaveBeenCalled();
  });
  it('uses selected device, local assets and VIDEO mode, publishes observations and stats', async () => {
    await source.start({ affectedHand: 'right', deviceId: 'camera-1' });
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: false,
        video: expect.objectContaining({ deviceId: { exact: 'camera-1' } }),
      }),
    );
    expect(mp.files).toHaveBeenCalledWith('/models/wasm');
    expect(mp.create).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        runningMode: 'VIDEO',
        numHands: 2,
        baseOptions: {
          modelAssetPath: '/models/hand_landmarker.task',
          delegate: 'GPU',
        },
      }),
    );
    const listener = vi.fn(),
      unsubscribe = source.onFrame(listener);
    await vi.advanceTimersByTimeAsync(34);
    await frame(34);
    expect(source.latest()).toMatchObject({
      detected: true,
      confidence: 0.95,
      closure: null,
    });
    expect(source.stats()).toMatchObject({
      delegate: 'GPU',
      frames: 1,
      inference: { samples: 1, p95: 0 },
      cameraToFrame: { p95: 5 },
    });
    expect(await CameraVision.devices()).toHaveLength(1);
    unsubscribe();
    source.stop();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(source.latest()).toMatchObject({
      detected: false,
      closure: null,
      confidence: 0,
    });
    expect(stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(source.videoElement()).toBeNull();
    expect(callbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('offers raw landmarks for recordings, including empty results, without changing normal frames', async () => {
    const listener = vi.fn();
    const unsubscribe = source.onLandmarks(listener);
    await source.start({ affectedHand: 'left' });
    await vi.advanceTimersByTimeAsync(34);
    await frame(34);
    expect(listener).toHaveBeenLastCalledWith({
      t: expect.any(Number),
      result,
    });
    expect(source.latest()?.handedness).toBe('left');
    const empty = {
      landmarks: [],
      worldLandmarks: [],
      handedness: [],
      handednesses: [],
    };
    detect.mockReturnValueOnce(empty);
    await vi.advanceTimersByTimeAsync(34);
    await frame(68);
    expect(listener).toHaveBeenLastCalledWith({
      t: expect.any(Number),
      result: empty,
    });
    expect(source.latest()?.detected).toBe(false);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(34);
    await frame(102);
    expect(listener).toHaveBeenCalledTimes(2);
  });
  it('applies a newly loaded affected-hand calibration to an already running camera', async () => {
    await source.start({ affectedHand: 'right' });
    await vi.advanceTimersByTimeAsync(34);
    await frame(34);
    expect(source.latest()?.handedness).toBe('right');
    source.setCalibration({
      affected_hand: 'left',
      open_flex: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
      closed_flex: {
        thumb: 100,
        index: 200,
        middle: 200,
        ring: 200,
        pinky: 200,
      },
      pinch_open: 1,
      pinch_closed: 0.1,
    });
    expect(source.latest()?.detected).toBe(false);
    await vi.advanceTimersByTimeAsync(34);
    await frame(68);
    expect(source.latest()?.handedness).toBe('left');
    expect(Object.keys(source.latest()!.closure!)).toEqual([
      'thumb',
      'index',
      'middle',
      'ring',
      'pinky',
    ]);
  });
  it('falls back to CPU if GPU initialization fails', async () => {
    mp.create.mockRejectedValueOnce(new Error('No WebGL'));
    await source.start({ affectedHand: 'left' });
    expect(source.stats().delegate).toBe('CPU');
    await vi.advanceTimersByTimeAsync(34);
    await frame(34);
    expect(source.latest()?.detected).toBe(true);
  });
  it('falls back after a GPU inference failure, without overlapping inferences', async () => {
    await source.start({ affectedHand: 'right' });
    detect.mockImplementationOnce(() => {
      throw new Error('GPU context lost');
    });
    await vi.advanceTimersByTimeAsync(34);
    await frame(34);
    expect(source.latest()?.detected).toBe(false);
    expect(source.stats().delegate).toBe('CPU');
    await vi.advanceTimersByTimeAsync(34);
    await frame(68);
    expect(source.latest()?.detected).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });
  it('skips duplicate/too-fast frames and invalidates a stalled camera within 200ms', async () => {
    await source.start({ affectedHand: 'right' });
    await vi.advanceTimersByTimeAsync(34);
    await frame(34);
    await frame(35, 0.034);
    expect(detect).toHaveBeenCalledTimes(1);
    expect(source.stats().skipped).toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(source.latest()).toMatchObject({
      detected: false,
      closure: null,
      confidence: 0,
    });
  });
  it('handles device loss and permission errors, and persists mirror preference', async () => {
    source.setMirrorHandedness(true);
    expect(new CameraVision().mirrorHandedness()).toBe(true);
    await source.start({ affectedHand: 'right' });
    track.dispatchEvent(new Event('ended'));
    expect(source.latest()?.detected).toBe(false);
    expect(source.stats().error).toBe('Camera disconnected');
    expect(vi.getTimerCount()).toBe(0);
    getUserMedia.mockRejectedValueOnce(new Error('Permission denied'));
    await expect(source.start({ affectedHand: 'right' })).rejects.toThrow(
      'Permission denied',
    );
    expect(source.stats().error).toBe('Permission denied');
  });
  it('stops late camera grants and late model loads after cancellation', async () => {
    let grant!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValueOnce(
      new Promise<MediaStream>((resolve) => {
        grant = resolve;
      }),
    );
    const starting = source.start({ affectedHand: 'right' });
    source.stop();
    grant({ getTracks: () => [track] } as unknown as MediaStream);
    await starting;
    expect(stop).toHaveBeenCalledOnce();
    expect(mp.create).not.toHaveBeenCalled();
    let load!: (model: HandLandmarker) => void;
    mp.create.mockReturnValueOnce(
      new Promise<HandLandmarker>((resolve) => {
        load = resolve;
      }),
    );
    const loading = source.start({ affectedHand: 'right' });
    await flush();
    source.stop();
    load(model);
    await loading;
    expect(close).toHaveBeenCalledOnce();
    expect(callbacks.size).toBe(0);
  });
  it('cleans resources when CPU initialization or inference fails', async () => {
    mp.create.mockRejectedValue(new Error('WASM unavailable'));
    await expect(source.start({ affectedHand: 'right' })).rejects.toThrow(
      'WASM unavailable',
    );
    expect(stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    mp.create
      .mockReset()
      .mockRejectedValueOnce(new Error('No GPU'))
      .mockResolvedValue(model);
    await source.start({ affectedHand: 'right' });
    detect.mockImplementationOnce(() => {
      throw new Error('Inference failed');
    });
    await vi.advanceTimersByTimeAsync(34);
    await frame(34);
    expect(source.latest()?.detected).toBe(false);
    expect(source.stats().error).toContain('Inference failed');
    expect(callbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('skips frames during pending fallback and closes a late CPU model after stop', async () => {
    await source.start({ affectedHand: 'right' });
    let resolveCPU!: (model: HandLandmarker) => void;
    mp.create.mockReturnValueOnce(
      new Promise<HandLandmarker>((resolve) => {
        resolveCPU = resolve;
      }),
    );
    detect.mockImplementationOnce(() => {
      throw new Error('GPU context lost');
    });
    await vi.advanceTimersByTimeAsync(34);
    await frame(34);
    await vi.advanceTimersByTimeAsync(34);
    await frame(68);
    expect(detect).toHaveBeenCalledTimes(1);
    expect(source.stats().skipped).toBe(1);
    source.stop();
    resolveCPU(model);
    await flush();
    expect(close).toHaveBeenCalledTimes(2);
    expect(callbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reports unavailable camera APIs as a recoverable start error', async () => {
    vi.stubGlobal('navigator', {});
    await expect(source.start({ affectedHand: 'right' })).rejects.toThrow(
      'HTTPS or localhost',
    );
    expect(source.stats().error).toContain('HTTPS or localhost');
    expect(source.latest()?.detected).toBe(false);
    expect(await CameraVision.devices()).toEqual([]);
  });
});
