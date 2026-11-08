import type { HandLandmarker } from '@mediapipe/tasks-vision';
import type {
  VisionSource,
  VisionFrame,
  Handedness,
} from '../contracts/vision';
import {
  CURRENT_CAMERA_VIEW,
  type CameraView,
  type CameraCalibration,
} from '../contracts/calibration';
import { FrameProcessor, missingFrame } from './frameProcessor';
import type { LandmarkCapture } from './recorder';
import { VideoLightingSampler, type VisionDiagnostics } from './lighting';
import {
  DeviceProfileSelector,
  RAW_PROFILE,
  StepScratch,
  deviceProfile,
  handRegion,
  savedDeviceSetting,
  saveDeviceSetting,
  suggestDeviceProfile,
  type DeviceProfile,
  type DeviceProfileId,
  type DeviceSetting,
} from './deviceProfiles';

type Delegate = 'GPU' | 'CPU';
/** While automatic mode tracks the raw video, read its pixels this often. */
const DEVICE_SAMPLE_FRAMES = 15;
type PreparedFrame = {
  /** Preprocessed copy for inference, or null to use the raw video. */
  image: ImageData | null;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
};
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
  /** Device setting and the profile applied to the latest frame. */
  device: { setting: DeviceSetting; active: DeviceProfileId };
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
  private landmarkListeners = new Set<(capture: LandmarkCapture) => void>();
  private generation = 0;
  private callback: number | null = null;
  private callbackIsVideo = false;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private affectedHand: Handedness = 'right';
  private mirror = savedMirror();
  private view: CameraView = CURRENT_CAMERA_VIEW;
  private lightingSampler = new VideoLightingSampler();
  private quality: VisionDiagnostics = {
    lighting: null,
    handednessMismatch: null,
  };
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
  private device = new DeviceProfileSelector(savedDeviceSetting());
  private stepScratch = new StepScratch();
  /** The profile applied to the latest frame in which the hand was detected. */
  private tracked: DeviceProfileId | null = null;
  /** The hand on the previous frame, or null if it was not detected. */
  private previousHand: VisionFrame['landmarks'] = null;
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private output: ImageData | null = null;
  /** Set when the browser cannot read video pixels; the raw video is used. */
  private pixelsUnavailable = false;

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
  deviceSetting(): DeviceSetting {
    return this.device.mode;
  }
  /** The profile applied before inference on the latest frame. */
  activeDeviceProfile(): DeviceProfileId {
    return this.pixelsUnavailable ? RAW_PROFILE : this.device.current;
  }
  /** The profile in use the last time the hand was detected, or null if never. */
  trackedDeviceProfile(): DeviceProfileId | null {
    return this.tracked;
  }
  /** Persists the setting; takes effect on the next frame. */
  setDeviceSetting(setting: DeviceSetting) {
    saveDeviceSetting(setting);
    this.device.configure(setting);
  }
  /**
   * Reads the frame's pixels and, if the profile has a preprocessing step,
   * applies it to a copy. Null (no pixels) keeps the raw video.
   */
  private prepare(
    video: HTMLVideoElement,
    profile: DeviceProfile,
  ): PreparedFrame | null {
    const width = video.videoWidth,
      height = video.videoHeight;
    if (!width || !height) return null;
    this.canvas ??= document.createElement('canvas');
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.context ??= this.canvas.getContext('2d', {
      willReadFrequently: true,
    });
    if (!this.context) {
      this.pixelsUnavailable = true;
      console.info('[vision] canvas unavailable; device profiles disabled');
      return null;
    }
    try {
      this.context.drawImage(video, 0, 0, width, height);
      const source = this.context.getImageData(0, 0, width, height);
      if (!profile.preprocess)
        return { image: null, pixels: source.data, width, height };
      if (this.output?.width !== width || this.output.height !== height)
        this.output = new ImageData(width, height);
      profile.preprocess(
        source.data,
        this.output.data,
        width,
        height,
        this.stepScratch,
        // Where the hand was; the whole frame while it is lost.
        handRegion(this.previousHand, width, height),
      );
      return { image: this.output, pixels: source.data, width, height };
    } catch {
      return null; // Use the raw video for this frame.
    }
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
    view?: CameraView;
  }): Promise<void> {
    this.stop();
    const generation = this.generation;
    this.affectedHand = options.affectedHand;
    this.view = options.view ?? CURRENT_CAMERA_VIEW;
    this.inference = [];
    this.latency = [];
    this.frames = 0;
    this.skipped = 0;
    this.error = null;
    // Setup may have changed the setting while another source was active.
    this.device.configure(savedDeviceSetting());
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
      // Browsers pause a media element when it is removed from the document, e.g. when a camera
      // preview unmounts on navigation. Hand tracking needs the stream running whether or not any
      // preview shows it, so resume unless the camera itself is stopping (stop() clears the stream
      // before pausing).
      video.addEventListener('pause', () => {
        if (this.video === video && this.stream)
          void video.play().catch(() => {});
      });
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
      const profile = deviceProfile(this.activeDeviceProfile());
      // On the raw video, automatic mode still samples pixels to notice a device.
      const sample =
        !profile.preprocess &&
        this.device.mode === 'auto' &&
        !this.pixelsUnavailable &&
        this.frames % DEVICE_SAMPLE_FRAMES === 0;
      const prepared =
        profile.preprocess || sample ? this.prepare(this.video, profile) : null;
      const result = this.landmarker.detectForVideo(
        prepared?.image ?? this.video,
        started,
      );
      const ended = performance.now();
      if (generation !== this.generation) return;
      this.landmarkListeners.forEach((cb) => cb({ t: started, result }));
      const frame = this.processor.process(
        result,
        started,
        this.affectedHand,
        this.mirror,
        this.view,
      );
      this.quality = {
        lighting: this.lightingSampler.sample(this.video, frame.landmarks),
        handednessMismatch: this.processor.handednessMismatch,
      };
      const hand = frame.detected ? frame.landmarks : null;
      this.previousHand = hand;
      if (hand) this.tracked = profile.id;
      this.device.update(
        started,
        frame.detected,
        prepared && hand && profile.preprocess && profile.coverage
          ? profile.coverage(
              prepared.pixels,
              prepared.width,
              prepared.height,
              hand,
            )
          : null,
        prepared && hand
          ? suggestDeviceProfile(
              prepared.pixels,
              prepared.width,
              prepared.height,
              hand,
            )
          : undefined,
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
    this.device.reset();
    this.previousHand = null;
    this.publish(missingFrame(performance.now()));
  }
  setCalibration(calibration: CameraCalibration | null): void {
    this.processor.calibration = calibration;
    if (calibration) this.affectedHand = calibration.affected_hand;
    this.processor.reset();
    this.publish(missingFrame(performance.now()));
  }
  diagnostics(): VisionDiagnostics {
    return performance.now() - this.lastResult < 100
      ? this.quality
      : { lighting: null, handednessMismatch: null };
  }
  private publish(frame: VisionFrame) {
    if (!frame.detected)
      this.quality = {
        lighting: this.quality.lighting,
        // Null, or true when the lone hand was dropped as the other hand.
        handednessMismatch: this.processor.handednessMismatch,
      };
    if (!this.stream)
      this.quality = { lighting: null, handednessMismatch: null };
    this.frame = frame;
    this.listeners.forEach((cb) => cb(frame));
  }
  onFrame(cb: (frame: VisionFrame) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  /** Raw geometry for explicit development recordings; bypasses filters/calibration. */
  onLandmarks(cb: (capture: LandmarkCapture) => void) {
    this.landmarkListeners.add(cb);
    return () => {
      this.landmarkListeners.delete(cb);
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
      device: { setting: this.device.mode, active: this.activeDeviceProfile() },
    };
  }
}
