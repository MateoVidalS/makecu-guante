import {
  CURRENT_CAMERA_VIEW,
  CURRENT_FLEX_MODEL,
  type CameraCalibration,
  type CameraView,
} from '../contracts/calibration';

/** Camera ranges must match both the capture posture and the flexion math. */
export function isCurrentCameraCalibration(
  camera: Pick<CameraCalibration, 'camera_view' | 'flex_model'>,
  view: CameraView = CURRENT_CAMERA_VIEW,
): boolean {
  return (
    (camera.camera_view ?? 'front_diagonal') === view &&
    (camera.flex_model ?? 1) === CURRENT_FLEX_MODEL
  );
}
