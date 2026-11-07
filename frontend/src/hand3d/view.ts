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
