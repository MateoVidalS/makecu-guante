import React from 'react';
import { c } from '../../brand/tokens';
import { skin } from './palette';

type Point = readonly [number, number];
type Finger = { closed: readonly Point[]; open: readonly Point[]; radius: number };

// Root, proximal joint, distal joint, tip. Every pose uses the same paths;
// openness interpolates all two-joint fingers continuously, including the thumb.
const fingers: Finger[] = [
  { radius: 18, closed: [[117, 265], [125, 244], [158, 246], [177, 261]], open: [[117, 265], [83, 231], [67, 204], [62, 187]] },
  { radius: 17, closed: [[128, 236], [125, 194], [133, 188], [137, 223]], open: [[128, 236], [115, 154], [109, 111], [107, 85]] },
  { radius: 18, closed: [[165, 226], [162, 181], [168, 179], [173, 216]], open: [[165, 226], [160, 134], [158, 82], [157, 52]] },
  { radius: 17, closed: [[201, 234], [199, 188], [205, 187], [209, 224]], open: [[201, 234], [206, 146], [210, 100], [212, 74]] },
  { radius: 15, closed: [[233, 249], [231, 207], [236, 207], [240, 242]], open: [[233, 249], [247, 181], [255, 151], [261, 128]] },
];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

// A rounded ribbon around a joint chain. Quadratic corners keep the vector
// language soft without changing drawings between a fist and an open palm.
function outline(points: Point[], radius: number): string {
  const sides = [-1, 1].map((side) => points.map(([x, y], i): Point => {
    const before = points[Math.max(0, i - 1)];
    const after = points[Math.min(points.length - 1, i + 1)];
    const dx = after[0] - before[0];
    const dy = after[1] - before[1];
    const length = Math.hypot(dx, dy) || 1;
    return [x - side * dy / length * radius, y + side * dx / length * radius];
  }));
  const polygon = [...sides[0], ...sides[1].reverse()];
  const mid = (a: Point, b: Point) => `${(a[0] + b[0]) / 2} ${(a[1] + b[1]) / 2}`;
  return `M${mid(polygon[polygon.length - 1], polygon[0])} ` + polygon.map((p, i) =>
    `Q${p[0]} ${p[1]} ${mid(p, polygon[(i + 1) % polygon.length])}`,
  ).join(' ') + ' Z';
}

export interface HandProps {
  openness: number;
  side: 'left' | 'right';
  ghost?: boolean;
  person?: keyof typeof skin;
  fill?: string;
  fingerFill?: string;
  style?: React.CSSProperties;
}

export const Hand: React.FC<HandProps> = ({ openness, side, ghost = false, person = 'rosa', fill, fingerFill, style }) => {
  const t = Math.max(0, Math.min(1, openness));
  const color = ghost ? 'none' : fill ?? skin[person];
  const stroke = ghost ? c.target : c.text;
  const paths = fingers.map((finger) => finger.closed.map((p, i): Point => [mix(p[0], finger.open[i][0], t), mix(p[1], finger.open[i][1], t)]));
  const pathStyle = { stroke, strokeWidth: 6, strokeLinecap: 'round', strokeLinejoin: 'round', vectorEffect: 'non-scaling-stroke' } as const;
  return (
    <svg viewBox="0 0 320 430" width="100%" height="100%" role="img" aria-label={`${ghost ? 'Goal: ' : ''}${person === 'rosa' ? 'Rosa' : 'Grandson'}’s ${t > 0.8 ? 'open hand' : t < 0.2 ? 'fist' : 'opening hand'}`} style={{ overflow: 'visible', ...style }}>
      <g transform={side === 'right' ? 'translate(320 0) scale(-1 1)' : undefined} opacity={ghost ? 0.6 : 1}>
        {/* Fingers sit behind the palm so their roots never form extra seams. */}
        {paths.slice(1).map((points, i) => <path key={i} d={outline(points, fingers[i + 1].radius)} fill={ghost ? 'none' : fingerFill ?? color} {...pathStyle} />)}
        <path d="M110 238 Q103 263 110 293 Q116 320 130 338 L129 420 L222 420 L221 338 Q249 314 248 275 L247 241 Q222 222 202 228 Q182 218 164 223 Q143 221 128 233 Z" fill={color} {...pathStyle} />
        <path d={outline(paths[0], fingers[0].radius)} fill={ghost ? 'none' : fingerFill ?? color} {...pathStyle} />
        <g fill="none" {...pathStyle}>
          <path d={`M140 ${291 - 8 * t} Q171 ${304 - 12 * t} 204 ${282 - 8 * t}`} />
          <path d="M148 337 Q178 344 204 336" />
          {!ghost && paths.slice(1).map((points, i) => <path key={i} d={`M${points[1][0] - 7} ${points[1][1] + 5} l14 -1 M${points[2][0] - 5} ${points[2][1] + 5} l10 -1`} strokeWidth={3} opacity={0.45 + t * 0.2} />)}
        </g>
      </g>
    </svg>
  );
};
