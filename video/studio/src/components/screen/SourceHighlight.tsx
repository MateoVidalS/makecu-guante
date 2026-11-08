import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { c, ease, radius } from '../../brand/tokens';
import { findEvent, mapPoint } from './camera';
import { useScreen } from './ScreenFrame';

export const SourceHighlight: React.FC<{ target: string; at: number }> = ({ target, at }) => {
  const frame = useCurrentFrame();
  const screen = useScreen();
  const box = findEvent(screen.clip, target, screen.frame)?.box;
  if (!box) return null;
  const point = mapPoint(box, screen.camera);
  const reveal = interpolate(frame - at, [0, 15], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const viewport = screen.camera.viewport;
  return <div style={{ position: 'absolute', left: viewport.x, top: viewport.y, width: viewport.w, height: viewport.h, overflow: 'hidden', pointerEvents: 'none' }}>
    <div style={{ position: 'absolute', left: point.x - viewport.x, top: point.y - viewport.y, width: box.w * screen.camera.scale * reveal, height: box.h * screen.camera.scale, borderRadius: radius.sm, background: c.accentSoft, mixBlendMode: 'multiply' }} />
  </div>;
};
