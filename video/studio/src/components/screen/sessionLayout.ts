import { interpolate } from 'remotion';
import { ease } from '../../brand/tokens';

export const SESSION_PIP = { x: 1424, y: 600, w: 400, h: 225 };

export function sessionLayout(frame: number) {
  const options = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease } as const;
  const innovation = interpolate(frame, [96, 120], [1, 0], options);
  const legend = interpolate(frame, [612, 636], [0, 1], options);
  const pip = interpolate(frame, [108, 120, 600, 612], [0, 1, 1, 0], options);
  const panel = Math.max(innovation, legend);
  return {
    innovation,
    legend,
    handZoom: 1.6 - 0.25 * interpolate(frame, [108, 120], [0, 1], options),
    area: { x: 64 + 680 * panel, y: 64, w: 1792 - 680 * panel - 544 * pip, h: 800 },
    align: { x: 0.5 + 0.05 * pip, y: 0.5 },
  };
}
