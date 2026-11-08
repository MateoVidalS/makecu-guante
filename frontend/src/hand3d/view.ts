import { CURRENT_CAMERA_VIEW, type CameraView } from '../contracts/calibration';
import type { Handedness } from '../contracts/vision';

/** Lay the model in the table plane: distal +Y becomes world +Z and the
 * palm normal +Z becomes world -Y (down). Camera is above, in front, thumb side.
 */
export const PALM_DOWN_ROTATION: [number, number, number] = [Math.PI / 2, 0, 0];
export function palmDownCamera(
  hand: Handedness,
  pinch = false,
): [number, number, number] {
  const thumbSide = pinch ? -5.2 : -4.2;
  return [hand === 'left' ? -thumbSide : thumbSide, 7.5, 3.3];
}
export const HAND_LOOK_AT: [number, number, number] = [0, 0, 0.8];

/** The rig already uses mirror-screen coordinates: a right thumb is on screen
 * left. Looking straight along its palm normal (+Z) preserves that selfie view;
 * +Y stays upright and positive flexion curls toward the viewer.
 */
export function handPresentation(
  hand: Handedness,
  view: CameraView = CURRENT_CAMERA_VIEW,
  pinch = false,
): {
  rotation: [number, number, number];
  camera: [number, number, number];
  lookAt: [number, number, number];
} {
  return view === 'front_upright'
    ? { rotation: [0, 0, 0], camera: [0, 0, 10], lookAt: [0, 0, 0] }
    : {
        rotation: PALM_DOWN_ROTATION,
        camera: palmDownCamera(hand, pinch),
        lookAt: HAND_LOOK_AT,
      };
}
