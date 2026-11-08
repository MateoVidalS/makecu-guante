import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { c, ease, font, radius, shadow, space, type, weight } from '../../brand/tokens';
import { findEvent, mapPoint, type Point } from './camera';
import { useScreen } from './ScreenFrame';

export const Callout: React.FC<{
  point: Point | string;
  label: string;
  dotColor: string;
  side: 'left' | 'right';
  at?: number;
  until?: number;
  position?: Point;
  pulseAt?: number;
  leader?: boolean;
}> = ({ point, label, dotColor, side, at = 0, until = Infinity, position, pulseAt, leader = true }) => {
  const sceneFrame = useCurrentFrame();
  const { clip, frame, camera } = useScreen();
  const event = typeof point === 'string' ? findEvent(clip, point, frame) : undefined;
  const anchor = typeof point !== 'string' ? point : event?.point ?? (event?.box ? { x: event.box.x + event.box.w / 2, y: event.box.y + event.box.h / 2 } : null);
  if (!anchor || sceneFrame < at || sceneFrame >= until) return null;
  const target = mapPoint(anchor, camera);
  const age = sceneFrame - at;
  const draw = interpolate(age, [0, 6], [0, 1], { extrapolateRight: 'clamp' });
  const enter = interpolate(age, [6, 15], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const exit = Math.min(1, (until - sceneFrame) / 9);
  const width = label.length * type.h3 * 0.49 + 84;
  const x = position?.x ?? Math.max(96, Math.min(1824 - width, side === 'left' ? target.x - width - 120 : target.x + 120));
  const y = position?.y ?? Math.max(128, Math.min(740, target.y - 40));
  const edge = side === 'left' ? x + width : x;
  const pulse = pulseAt === undefined ? 0 : interpolate(sceneFrame - pulseAt, [0, 9, 24], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: exit, pointerEvents: 'none' }}>
      {leader ? <svg width={1920} height={900} style={{ position: 'absolute', inset: 0 }}>
        <path d={`M${edge},${y + 40} H${(edge + target.x) / 2} L${target.x},${target.y}`} pathLength={1} stroke={c.text} strokeWidth={1.5} fill="none" strokeDasharray={1} strokeDashoffset={1 - draw} />
        <circle cx={target.x} cy={target.y} r={5} fill={c.surface} stroke={c.text} strokeWidth={1.5} opacity={draw} />
      </svg> : null}
      <div style={{ position: 'absolute', left: x, top: y, width: 'max-content', minWidth: width, minHeight: 80, padding: `16px ${space.s24}px`, boxSizing: 'border-box', border: `1px solid ${c.border}`, borderRadius: radius.pill, background: c.surface, boxShadow: shadow, display: 'flex', gap: space.s16, alignItems: 'center', opacity: enter, transform: `translateY(${(1 - enter) * 8}px) scale(${1 + pulse * 0.025})`, transformOrigin: side === 'left' ? 'right center' : 'left center', fontFamily: font, fontSize: type.h3, fontWeight: weight.semibold, color: c.text, whiteSpace: 'nowrap' }}>
        <span style={{ width: 16 + pulse * 4, height: 16 + pulse * 4, flexShrink: 0, borderRadius: radius.pill, background: dotColor }} />
        {label}
      </div>
    </div>
  );
};
