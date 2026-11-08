import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { c, ease, radius, shadow, space } from '../../brand/tokens';
import { COPY } from '../../script';
import { Badge, T } from '../brand';

const points = [
  [160, 294], [109, 250], [77, 212], [51, 181], [30, 160],
  [112, 190], [102, 124], [97, 70], [94, 28],
  [161, 180], [163, 105], [165, 52], [167, 12],
  [207, 189], [219, 123], [228, 77], [235, 40],
  [242, 211], [270, 165], [285, 128], [300, 96],
];
const chains = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12], [0, 13, 14, 15, 16], [0, 17, 18, 19, 20], [5, 9, 13, 17]];

// The standard 21-point topology is an explanatory diagram, not invented tracking telemetry.
export const VisionInset: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12, 168, 180], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  return <div style={{ position: 'absolute', left: 96, top: 560, width: 640, height: 310, padding: space.s24, boxSizing: 'border-box', display: 'flex', gap: space.s24, alignItems: 'center', background: c.surface, border: `1px solid ${c.border}`, borderRadius: radius.card, boxShadow: shadow, opacity }}>
    <svg width={220} height={240} viewBox="0 0 320 320" style={{ flexShrink: 0 }} aria-label="21 MediaPipe hand landmarks">
      {chains.map((chain, index) => <polyline key={index} points={chain.map((i) => points[i].join(',')).join(' ')} fill="none" stroke={c.text} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />)}
      {points.map(([x, y], index) => <circle key={index} cx={x} cy={y} r={6} fill={c.brand} />)}
    </svg>
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.s16 }}>
      <T size="small">{COPY.session.vision.title}</T>
      <T size="caption" color={c.muted} w={400}>{COPY.session.vision.sub}</T>
      <Badge kind="illustrative" style={{ alignSelf: 'flex-start' }} />
    </div>
  </div>;
};
