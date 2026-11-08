import React from 'react';
import { c } from '../../brand/tokens';

// MediaPipe's wrist + four joints on each of five fingers: 21 landmarks.
const points = [
  [160, 330], [113, 280], [79, 237], [61, 203], [49, 177],
  [120, 211], [112, 148], [108, 103], [106, 76],
  [160, 200], [158, 128], [157, 80], [156, 47],
  [200, 210], [206, 145], [210, 106], [213, 77],
  [234, 231], [249, 186], [258, 156], [264, 132],
];
const chains = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12], [0, 13, 14, 15, 16], [0, 17, 18, 19, 20], [5, 9, 13, 17]];

export const Landmarks: React.FC<{ draw: number }> = ({ draw }) => (
  <svg viewBox="0 0 320 380" width="100%" height="100%" role="img" aria-label="A hand measured with 21 landmarks">
    {chains.map((chain, i) => <path key={i} d={chain.map((index, j) => `${j === 0 ? 'M' : 'L'}${points[index].join(' ')}`).join(' ')} fill="none" stroke={c.text} strokeWidth={2} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />)}
    {points.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={5} fill={c.brand} opacity={Math.max(0, Math.min(1, draw * 2 - i / points.length))} />)}
  </svg>
);

export const Waveform: React.FC<{ frame: number; draw: number }> = ({ frame, draw }) => (
  <svg viewBox="0 0 420 380" width="100%" height="100%" role="img" aria-label="A calm voice waveform">
    {Array.from({ length: 29 }, (_, i) => {
      const envelope = Math.sin((i + 1) / 30 * Math.PI) ** 2;
      const amplitude = (16 + envelope * (44 + 25 * Math.sin(i * 1.75 + frame / 24) ** 2)) * draw;
      return <path key={i} d={`M${14 + i * 14} ${190 - amplitude} V${190 + amplitude}`} fill="none" stroke={c.brand} strokeWidth={6} strokeLinecap="round" />;
    })}
  </svg>
);
