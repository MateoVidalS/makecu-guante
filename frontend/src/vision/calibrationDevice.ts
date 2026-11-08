import type { CameraCalibration } from '../contracts/calibration';
import type { FingerId } from '../contracts/vision';
import {
  deviceProfile,
  isDeviceSetting,
  type DeviceProfileId,
} from './deviceProfiles';

/**
 * Camera calibrations are device-specific: a glove or device shifts where
 * MediaPipe puts the joints, so open/closed flex sums captured with one device
 * do not fit another. The frozen CameraCalibration has no device field, so the
 * profile in use when a camera calibration was saved is kept here, in
 * localStorage, keyed to that calibration's values.
 */
const STORAGE_KEY = 'rehab-hub.camera.calibration-device';
const FINGERS: readonly FingerId[] = [
  'thumb',
  'index',
  'middle',
  'ring',
  'pinky',
];

/** Identifies a camera calibration by its values (stable across saves and reloads). */
export function calibrationKey(camera: CameraCalibration): string {
  const n = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
  return [
    camera.affected_hand,
    camera.camera_view ?? '',
    camera.flex_model ?? 1,
    ...FINGERS.map((f) => n(camera.open_flex[f])),
    ...FINGERS.map((f) => n(camera.closed_flex[f])),
    n(camera.pinch_open),
    n(camera.pinch_closed),
  ].join('|');
}

/** Remembers which profile `camera` was captured with. Only the latest calibration is kept. */
export function rememberCalibrationDevice(
  camera: CameraCalibration,
  profile: DeviceProfileId,
) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ key: calibrationKey(camera), profile }),
    );
  } catch {
    /* Private browsing may disallow storage. */
  }
}

/** The profile `camera` was captured with, or null if unknown. */
export function calibrationDevice(
  camera: CameraCalibration | null | undefined,
): DeviceProfileId | null {
  if (!camera) return null;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as {
      key?: unknown;
      profile?: unknown;
    } | null;
    if (saved?.key !== calibrationKey(camera)) return null;
    const profile = saved.profile;
    return isDeviceSetting(profile) && profile !== 'auto' ? profile : null;
  } catch {
    return null;
  }
}

/** Short notice when the hand now wears another device than at calibration, else null. */
export function calibrationDeviceNotice(
  calibratedWith: DeviceProfileId | null,
  active: DeviceProfileId | null,
): string | null {
  if (!calibratedWith || !active || calibratedWith === active) return null;
  return `Calibrated with ${deviceProfile(calibratedWith).label.toLowerCase()}. Calibrate again for ${deviceProfile(active).label.toLowerCase()}.`;
}
