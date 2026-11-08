import { interpolate } from 'remotion';
import { ease } from '../../brand/tokens';

export const progress = (frame: number, start: number, duration = 15) =>
  interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
  });
