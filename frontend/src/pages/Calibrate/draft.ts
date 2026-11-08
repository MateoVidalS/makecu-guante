import { captureStats } from '../../vision/calibration';
import type { CalibrationIn } from '../../contracts/api';
import type { FingerId, VisionFrame } from '../../contracts/vision';
import {
  CURRENT_CAMERA_VIEW,
  CURRENT_ASSIST_DIRECTION,
  type AssistDirection,
  CURRENT_FLEX_MODEL,
  type CameraView,
  type Calibration,
  type ServoCalibration,
} from '../../contracts/calibration';
import { isCurrentCameraCalibration } from '../../vision/calibrationCompatibility';
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
  sourceId?: number;
  cameraView?: CameraView;
  flexModel?: number;
  assistDirection?: AssistDirection;
  edited?: boolean;
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
  cameraView: CURRENT_CAMERA_VIEW,
  flexModel: CURRENT_FLEX_MODEL,
  assistDirection: CURRENT_ASSIST_DIRECTION,
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
/** Routing changes reset every range; posture or math changes reset camera captures only. */
function currentCameraDraft(draft: Draft): Draft {
  if (draft.assistDirection !== CURRENT_ASSIST_DIRECTION)
    return { ...freshDraft(), sourceId: draft.sourceId };
  return isCurrentCameraCalibration({
    camera_view: draft.cameraView,
    flex_model: draft.flexModel,
  })
    ? draft
    : {
        ...draft,
        cameraView: CURRENT_CAMERA_VIEW,
        flexModel: CURRENT_FLEX_MODEL,
        step: fingers.every((finger) => validRange(draft.servo[finger]))
          ? 1
          : 0,
        open: null,
        closed: null,
        pinch: null,
      };
}
// Keep only calibration values, never a movement command, across route changes.
let memory = freshDraft();
export function loadDraft(): Draft {
  try {
    const value = sessionStorage.getItem('rehab-calibration');
    if (value) {
      const parsed = JSON.parse(value) as Draft;
      const saved = { ...freshDraft(), ...parsed };
      return currentCameraDraft({
        ...saved,
        cameraView: parsed.cameraView,
        flexModel: parsed.flexModel,
        assistDirection: parsed.assistDirection,
        step: Math.min(2, saved.step),
      });
    }
  } catch {
    /* Storage may be disabled. */
  }
  return currentCameraDraft(memory);
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

/** Saved values are a complete starting point for review or a focused redo. */
export function draftFromCalibration(calibration: Calibration): Draft {
  return currentCameraDraft({
    ...freshDraft(),
    cameraView: calibration.camera.camera_view,
    flexModel: calibration.camera.flex_model,
    assistDirection: calibration.assist_direction,
    step: 2,
    sourceId: calibration.id,
    servo: Object.fromEntries(
      calibration.servo.map((range) => [range.finger, { ...range }]),
    ),
    hand: calibration.camera.affected_hand,
    open: {
      raw: { ...calibration.camera.open_flex },
      pinch: calibration.camera.pinch_open,
    },
    closed: {
      raw: { ...calibration.camera.closed_flex },
      pinch: calibration.camera.pinch_closed,
    },
    limit: calibration.current_limit_ma,
    friction: calibration.friction,
  });
}

export function resumableDraft(calibration: Calibration | null): Draft {
  const draft = loadDraft();
  return calibration && !(draft.sourceId === calibration.id && draft.edited)
    ? draftFromCalibration(calibration)
    : draft;
}
