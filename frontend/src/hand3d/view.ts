import type { Handedness } from '../contracts/vision';

/** +Z is the palm; the camera sees the back (-Z), from the thumb side (-X).
 * +Y is distal, so the front diagonal looks from above the fingertips.
 */
export function palmDownCamera(
  hand: Handedness,
  pinch = false,
): [number, number, number] {
  const thumbSide = pinch ? -5.2 : -4.2;
  return [hand === 'left' ? -thumbSide : thumbSide, 3.3, -7.5];
}
export const HAND_LOOK_AT: [number, number, number] = [0, 0.8, 0];
