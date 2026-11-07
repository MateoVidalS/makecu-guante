import type { CameraCalibration } from '../../contracts/calibration';
import type {
  FingerId,
  Handedness,
  JointAngles,
  VisionFrame,
  VisionSource,
} from '../../contracts/vision';
import { Signal } from '../clientBase';
import { clamp } from './simFirmware';
import type { SimWorld } from './simWorld';

const fingers: FingerId[] = ['thumb', 'index', 'middle', 'ring', 'pinky'];
// Local linear fallback until WP6's jointsFromClosure is available. Keep integration isolated here.
export function jointsFromClosure(
  closure: Record<FingerId, number>,
): Record<FingerId, JointAngles> {
  return Object.fromEntries(
    fingers.map((f) => [
      f,
      f === 'thumb'
        ? { mcp: 50 * closure[f], pip: 50 * closure[f], dip: 0 }
        : { mcp: 90 * closure[f], pip: 100 * closure[f], dip: 80 * closure[f] },
    ]),
  ) as Record<FingerId, JointAngles>;
}
export class SimVision implements VisionSource {
  readonly kind = 'sim' as const;
  private running = false;
  private hand: Handedness = 'right';
  private calibration: CameraCalibration | null = null;
  private frame: VisionFrame | null = null;
  private pending: { due: number; frame: VisionFrame }[] = [];
  private frames = new Signal<VisionFrame>();
  onFrame = this.frames.subscribe;
  constructor(readonly world: SimWorld) {
    world.camera.subscribe((now) => {
      if (!this.running) return;
      const detected = now >= world.handHiddenUntil;
      const real = world.patient.realPosition(
        world.firmware.position,
        world.random,
      );
      const closure = Object.fromEntries(
        fingers.map((f, i) => [
          f,
          clamp(real[i] + (world.random() - 0.5) * 0.04, 0, 1.1),
        ]),
      ) as Record<FingerId, number>;
      const joints = jointsFromClosure(closure);
      const rawFlexSum = Object.fromEntries(
        fingers.map((f) => [f, joints[f].mcp + joints[f].pip + joints[f].dip]),
      ) as Record<FingerId, number>;
      // A calibrated camera reports closure normalized against the captured flex range.
      const normalized = this.calibration
        ? (Object.fromEntries(
            fingers.map((f) => {
              const c = this.calibration!;
              const span = c.closed_flex[f] - c.open_flex[f];
              return [
                f,
                Math.abs(span) < 1e-6
                  ? 0
                  : clamp((rawFlexSum[f] - c.open_flex[f]) / span, 0, 1.1),
              ];
            }),
          ) as Record<FingerId, number>)
        : closure;
      this.pending.push({
        due: now + 60,
        frame: {
          t: world.origin + now,
          detected,
          confidence: detected ? 0.95 : 0,
          handedness: detected ? this.hand : null,
          closure: detected && this.calibration ? normalized : null,
          rawFlexSum: detected ? rawFlexSum : null,
          joints: detected ? joints : null,
          pinch: detected
            ? 1 -
              0.9 *
                Math.min(1, Math.min(closure.thumb / 0.5, closure.index / 0.55))
            : null,
          landmarks: null,
        },
      });
    });
  }
  async start(opts: { deviceId?: string; affectedHand: Handedness }) {
    this.hand = opts.affectedHand;
    this.running = true;
    this.world.start();
  }
  stop() {
    this.running = false;
    this.frame = null;
    this.pending = [];
  }
  setCalibration(c: CameraCalibration | null) {
    this.calibration = c;
  }
  latest() {
    return this.frame;
  }
  videoElement() {
    return null;
  }
  deliver(now: number) {
    while (this.running && this.pending.length && this.pending[0].due <= now) {
      this.frame = this.pending.shift()!.frame;
      this.frames.emit(this.frame);
    }
  }
}
