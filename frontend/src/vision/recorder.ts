import type { PoseId } from '../contracts/poses';
import type { Handedness } from '../contracts/vision';
import type { HandResult } from './frameProcessor';
import { CAMERA_PLACEMENT_GUIDANCE } from './robustness';

export interface LandmarkCapture {
  t: number;
  result: HandResult;
}
export interface LandmarkResultSource {
  onLandmarks(cb: (capture: LandmarkCapture) => void): () => void;
}
export interface LandmarkRecording {
  source: 'webcam landmarks; not synthetic; no video or audio';
  pose: PoseId;
  affectedHand: Handedness;
  glove: 'bare-hand-points' | 'glove' | 'bare-hand' | 'exposed-fingertips';
  requestedSetup: string;
  durationMs: number;
  frames: LandmarkCapture[];
}

/** Development-only opt-in capture of raw results, including low scores/misses.
 * Copy MediaPipe buffers before the next inference; bound memory and duration.
 */
export function recordLandmarks(
  source: LandmarkResultSource,
  options: Pick<LandmarkRecording, 'pose' | 'affectedHand'> & {
    glove?: LandmarkRecording['glove'];
    durationMs?: number;
  },
) {
  const durationMs = options.durationMs ?? 30000;
  if (!Number.isFinite(durationMs) || durationMs < 1 || durationMs > 30000)
    throw new Error('Choose a recording duration between 1 and 30000 ms');
  const started = performance.now();
  const frames: LandmarkCapture[] = [];
  let recording: LandmarkRecording | null = null;
  let resolve!: (value: LandmarkRecording) => void;
  const finished = new Promise<LandmarkRecording>((done) => {
    resolve = done;
  });
  const unsubscribe = source.onLandmarks(({ t, result }) => {
    const relative = t - started;
    if (
      !Number.isFinite(relative) ||
      relative < 0 ||
      relative > durationMs ||
      (frames.length && relative <= frames.at(-1)!.t)
    )
      return;
    if (frames.length >= 1800) {
      stop();
      return;
    }
    frames.push({ t: relative, result: structuredClone(result) });
  });
  const timer = setTimeout(stop, durationMs);
  function stop(): LandmarkRecording {
    if (recording) return recording;
    clearTimeout(timer);
    unsubscribe();
    recording = {
      source: 'webcam landmarks; not synthetic; no video or audio',
      pose: options.pose,
      affectedHand: options.affectedHand,
      glove: options.glove ?? 'bare-hand-points',
      requestedSetup: CAMERA_PLACEMENT_GUIDANCE,
      durationMs: Math.min(
        durationMs,
        Math.max(0, performance.now() - started),
      ),
      frames,
    };
    resolve(recording);
    return recording;
  }
  return { finished, stop };
}

/** Call from an explicit browser Download action; never sends data to a server. */
export function downloadLandmarks(recording: LandmarkRecording) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(recording)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `landmarks_${recording.affectedHand}_${recording.glove}_${recording.pose}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
