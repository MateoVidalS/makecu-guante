import type { FingerId } from '../contracts/vision';

const FINGER_NAMES: Record<FingerId, string> = {
  thumb: 'thumb',
  index: 'index',
  middle: 'middle',
  ring: 'ring',
  pinky: 'little finger',
};

/** Patient-facing names; protocol and stored finger IDs stay unchanged. */
export const fingerName = (finger: FingerId): string => FINGER_NAMES[finger];
