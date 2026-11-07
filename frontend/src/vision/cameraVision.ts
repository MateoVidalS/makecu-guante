import type { HandLandmarker } from '@mediapipe/tasks-vision';
import type {
  VisionSource,
  VisionFrame,
  Handedness,
} from '../contracts/vision';
import type { CameraCalibration } from '../contracts/calibration';
import { FrameProcessor, missingFrame } from './frameProcessor';

type Delegate = 'GPU' | 'CPU';
export interface LatencyStats {
  p50: number | null;
  p95: number | null;
  samples: number;
}
export interface CameraStats {
  delegate: Delegate | null;
  inference: LatencyStats;
  cameraToFrame: LatencyStats;
  frames: number;
  skipped: number;
  error: string | null;
}
const percentiles = (values: number[]): LatencyStats => {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) =>
    sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
  return {
    p50: percentile(0.5),
    p95: percentile(0.95),
    samples: sorted.length,
  };
};
const MIRROR_KEY = 'rehab-hub.camera.mirror-handedness';
function savedMirror(): boolean {
  try {
    return localStorage.getItem(MIRROR_KEY) === 'true';
  } catch {
    return false;
  }
}

export class CameraVision implements VisionSource {
  readonly kind = 'camera' as const;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private landmarker: HandLandmarker | null = null;
  private processor = new FrameProcessor();
  private listeners = new Set<(frame: VisionFrame) => void>();
  private frame: VisionFrame | null = null;
  private generation = 0;
  private callback: number | null = null;
  private callbackIsVideo = false;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private affectedHand: Handedness = 'right';
  private mirror = savedMirror();
  private busy = false;
  private previousMediaTime = -1;
  private lastInference = -Infinity;
  private lastResult = -Infinity;
  private inference: number[] = [];
  private latency: number[] = [];
  private delegate: Delegate | null = null;
  private frames = 0;
  private skipped = 0;
  private error: string | null = null;

  static async devices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    return (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === 'videoinput',
    );
  }
  mirrorHandedness() {
    return this.mirror;
  }
  setMirrorHandedness(mirror: boolean) {
    this.mirror = mirror;
    try {
      localStorage.setItem(MIRROR_KEY, String(mirror));
    } catch {
      /* Private browsing may disallow storage. */
    }
    this.processor.reset();
    this.publish(missingFrame(performance.now()));
  }
  private async createLandmarker(delegate: Delegate): Promise<HandLandmarker> {
    const { FilesetResolver, HandLandmarker } =
      await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks(
      `${import.meta.env.BASE_URL}models/wasm`,
    );
    return HandLandmarker.createFromOptions(files, {
      baseOptions: {
        modelAssetPath: `${import.meta.env.BASE_URL}models/hand_landmarker.task`,
        delegate,
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
  }
  async start(options: {
    deviceId?: string;
    affectedHand: Handedness;
  }): Promise<void> {
    this.stop();
    const generation = this.generation;
    this.affectedHand = options.affectedHand;
    this.inference = [];
    this.latency = [];
    this.frames = 0;
    this.skipped = 0;
    this.error = null;
    let stream: MediaStream | null = null;
    let model: HandLandmarker | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          'Use Chrome or Edge with camera access on HTTPS or localhost',
        );
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
          ...(options.deviceId
            ? { deviceId: { exact: options.deviceId } }
            : {}),
        },
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      stream
        .getVideoTracks()
        .forEach((track) => track.addEventListener('ended', this.onEnded));
      const video = document.createElement('video');
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      this.video = video;
      await video.play();
      if (generation !== this.generation) return;
      try {
        model = await this.createLandmarker('GPU');
        if (generation === this.generation) this.delegate = 'GPU';
      } catch {
        if (generation !== this.generation) return;
        console.info('[vision] GPU unavailable; using CPU');
        model = await this.createLandmarker('CPU');
        if (generation === this.generation) this.delegate = 'CPU';
      }
      if (generation !== this.generation) {
        model.close();
        return;
      }
      this.landmarker = model;
      this.lastResult = performance.now();
      this.watchdog = setInterval(() => {
        // A stalled camera must never leave a detected frame latched indefinitely.
        if (performance.now() - this.lastResult >= 100)
          this.publish(this.processor.missing(performance.now()));
      }, 50);
      this.schedule(generation);
    } catch (error) {
      if (generation !== this.generation) {
        model?.close();
        return;
      }
      this.stop();
      this.error =
        error instanceof Error ? error.message : 'Camera unavailable';
      throw error;
    }
  }
  private onEnded = () => {
    this.stop();
    this.error = 'Camera disconnected';
  };
  private schedule(generation: number) {
    const video = this.video;
    if (!video || generation !== this.generation) return;
    if (typeof video.requestVideoFrameCallback === 'function') {
      this.callbackIsVideo = true;
      this.callback = video.requestVideoFrameCallback((now, metadata) => {
        void this.tick(
          generation,
          now,
          metadata.mediaTime,
          metadata.captureTime ?? metadata.presentationTime,
        );
      });
    } else {
      this.callbackIsVideo = false;
      this.callback = requestAnimationFrame((now) => {
        void this.tick(generation, now, video.currentTime, now);
      });
    }
  }
  private async tick(
    generation: number,
    now: number,
    mediaTime: number,
    captured: number,
  ) {
    if (generation !== this.generation) return;
    this.schedule(generation);
    if (
      this.busy ||
      !this.video ||
      !this.landmarker ||
      this.video.readyState < 2 ||
      mediaTime === this.previousMediaTime ||
      now - this.lastInference < 30
    ) {
      this.skipped++;
      return;
    }
    this.busy = true;
    this.previousMediaTime = mediaTime;
    this.lastInference = now;
    try {
      const started = performance.now();
      const result = this.landmarker.detectForVideo(this.video, started);
      const ended = performance.now();
      if (generation !== this.generation) return;
      const frame = this.processor.process(
        result,
        started,
        this.affectedHand,
        this.mirror,
      );
      this.lastResult = ended;
      this.inference.push(ended - started);
      this.latency.push(Math.max(0, performance.now() - captured));
      if (this.inference.length > 300) {
        this.inference.shift();
        this.latency.shift();
      }
      this.frames++;
      this.publish(frame);
      if (this.frames % 300 === 0)
        console.info('[vision] latency (ms)', this.stats());
    } catch (error) {
      this.publish(this.processor.missing(performance.now()));
      if (this.delegate === 'GPU') {
        this.landmarker?.close();
        this.landmarker = null;
        try {
          const model = await this.createLandmarker('CPU');
          if (generation !== this.generation) {
            model.close();
            return;
          }
          this.landmarker = model;
          this.delegate = 'CPU';
          console.info('[vision] GPU inference failed; using CPU');
        } catch (fallbackError) {
          if (generation === this.generation) {
            this.stop();
            this.error = String(fallbackError);
          }
        }
      } else {
        this.stop();
        this.error = String(error);
      }
    } finally {
      if (generation === this.generation) this.busy = false;
    }
  }
  stop(): void {
    this.generation++;
    if (this.callback !== null && this.video) {
      if (this.callbackIsVideo)
        this.video.cancelVideoFrameCallback(this.callback);
      else cancelAnimationFrame(this.callback);
    }
    this.callback = null;
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    this.stream?.getTracks().forEach((track) => {
      track.removeEventListener('ended', this.onEnded);
      track.stop();
    });
    this.stream = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
      this.video.remove();
    }
    this.video = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.delegate = null;
    this.busy = false;
    this.previousMediaTime = -1;
    this.lastInference = -Infinity;
    this.processor.reset();
    this.publish(missingFrame(performance.now()));
  }
  setCalibration(calibration: CameraCalibration | null): void {
    this.processor.calibration = calibration;
    this.processor.reset();
    this.publish(missingFrame(performance.now()));
  }
  private publish(frame: VisionFrame) {
    this.frame = frame;
    this.listeners.forEach((cb) => cb(frame));
  }
  onFrame(cb: (frame: VisionFrame) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  latest() {
    return this.frame;
  }
  videoElement() {
    return this.video;
  }
  stats(): CameraStats {
    return {
      delegate: this.delegate,
      inference: percentiles(this.inference),
      cameraToFrame: percentiles(this.latency),
      frames: this.frames,
      skipped: this.skipped,
      error: this.error,
    };
  }
}
