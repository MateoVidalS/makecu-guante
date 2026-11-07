import { captureStats } from '../../vision/calibration';
import type { CalibrationIn } from '../../contracts/api';
import type { FingerId, VisionFrame } from '../../contracts/vision';
import type { ServoCalibration } from '../../contracts/calibration';
export const fingers: FingerId[] = [
  'thumb',
  'index',
  'middle',
  'ring',
  'pinky',
];
export interface Capture {
  raw: Record<FingerId, number>;
  pinch: number;
}
export interface Draft {
  step: number;
  finger: number;
  angle: number;
  servo: Partial<
    Record<
      'thumb' | 'index' | 'middle' | 'ring' | 'pinky',
      Partial<ServoCalibration>
    >
  >;
  hand: 'left' | 'right';
  mirror: boolean;
  open: Capture | null;
  closed: Capture | null;
  pinch: Capture | null;
  friction: CalibrationIn['friction'];
  limit: number;
}
export const freshDraft = (): Draft => ({
  step: 0,
  finger: 0,
  angle: 90,
  servo: {},
  hand: 'right',
  mirror: true,
  open: null,
  closed: null,
  pinch: null,
  friction: {},
  limit: 1500,
});
// Keep only calibration values, never a movement command, across route changes.
let memory = freshDraft();
export function loadDraft(): Draft {
  try {
    const value = sessionStorage.getItem('rehab-calibration');
    if (value) {
      const saved = { ...freshDraft(), ...JSON.parse(value) } as Draft;
      return { ...saved, step: Math.min(2, saved.step) };
    }
  } catch {
    /* Storage may be disabled. */
  }
  return memory;
}
export function saveDraft(draft: Draft) {
  memory = draft;
  try {
    sessionStorage.setItem('rehab-calibration', JSON.stringify(draft));
  } catch {
    /* In-memory resume still works. */
  }
}
export function validRange(range: Partial<ServoCalibration> | undefined) {
  return (
    !!range &&
    Number.isFinite(range.min_deg) &&
    Number.isFinite(range.max_deg) &&
    range.min_deg! >= 5 &&
    range.min_deg! <= 175 &&
    range.max_deg! >= 5 &&
    range.max_deg! <= 175 &&
    Math.abs(range.max_deg! - range.min_deg!) >= 20
  );
}
export function stableCapture(frames: VisionFrame[]): Capture {
  const valid = frames.filter(
    (f) => f.detected && f.confidence >= 0.6 && f.rawFlexSum && f.pinch != null,
  );
  if (
    valid.length < 20 ||
    valid.length !== frames.length ||
    valid.at(-1)!.t - valid[0].t < 1800
  )
    throw new Error('Keep your hand in view. Try again.');
  for (const finger of fingers) {
    const values = valid.map((f) => f.rawFlexSum![finger]);
    if (
      values.some((v) => !Number.isFinite(v)) ||
      Math.max(...values) - Math.min(...values) > 12
    )
      throw new Error("Too much movement — let's try again.");
  }
  const pinches = valid.map((f) => f.pinch!);
  if (
    pinches.some((v) => !Number.isFinite(v) || v < 0) ||
    Math.max(...pinches) - Math.min(...pinches) > 0.08
  )
    throw new Error("Too much movement — let's try again.");
  const measured = captureStats(frames, 2);
  return { raw: measured.rawFlexSum, pinch: measured.pinch };
}
