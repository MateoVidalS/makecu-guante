import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { c, radius, shadow, space } from '../../brand/tokens';
import { T } from '../brand';

// Illustrative trace: deliberately unlabeled in mA, never presented as measured telemetry.
export const CurrentTrace: React.FC<{ at: number; releaseAt: number }> = ({ at, releaseAt }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame - at, [0, 15], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const progress = interpolate(frame, [at, releaseAt, releaseAt + 18], [0, 0.72, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <div style={{ position: 'absolute', left: 96, top: 600, width: 640, padding: space.s24, boxSizing: 'border-box', border: `1px solid ${c.border}`, background: c.surface, borderRadius: radius.card, boxShadow: shadow, opacity: enter }}>
    <div style={{ display: 'flex', justifyContent: 'space-between' }}><T size="small">{frame < releaseAt ? 'Resistance rises' : 'memo releases'}</T><T size="caption" color={c.muted} w={400}>Illustrative trace</T></div>
    <svg width="100%" height={150} viewBox="0 0 590 150">
      <path d="M0 125 H590" stroke={c.border} strokeWidth={1} />
      <path d="M0 120 L100 120 L150 112 L200 112 L250 90 L300 58 L360 24 L400 24 L430 120 L590 120" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - progress} fill="none" stroke={frame < releaseAt ? c.danger : c.text} strokeWidth={4} strokeLinejoin="round" />
    </svg>
  </div>;
};
