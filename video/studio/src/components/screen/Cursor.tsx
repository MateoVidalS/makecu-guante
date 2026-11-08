import React from 'react';
import { c, ease } from '../../brand/tokens';
import { mapPoint } from './camera';
import { useScreen } from './ScreenFrame';

export const Cursor: React.FC = () => {
  const { clip, frame, camera } = useScreen();
  const clicks = clip.events.filter((event) => event.kind === 'click' && (event.point || event.box)).sort((a, b) => a.frame - b.frame);
  const next = clicks.find((event) => event.frame >= frame) ?? clicks.at(-1);
  if (!next || frame < clicks[0].frame - 24 || frame > clicks[clicks.length - 1].frame + 36) return null;
  const index = clicks.indexOf(next);
  const previous = clicks[Math.max(0, index - 1)];
  const point = (event: typeof next) => event.point ?? { x: event.box!.x + event.box!.w / 2, y: event.box!.y + event.box!.h / 2 };
  const end = point(next);
  const start = index === 0 ? { x: end.x - 100, y: end.y + 80 } : point(previous);
  const moveStart = Math.max(previous.frame, next.frame - 24);
  const t = ease(Math.max(0, Math.min(1, (frame - (index === 0 ? next.frame - 24 : moveStart)) / Math.max(1, next.frame - moveStart || 24))));
  const pos = mapPoint({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }, camera);
  const clicked = [...clicks].reverse().find((event) => event.frame <= frame);
  const age = clicked ? frame - clicked.frame : Infinity;
  const press = age < 15 ? age / 15 : 1;
  const viewport = camera.viewport;
  if (pos.x < viewport.x || pos.x > viewport.x + viewport.w || pos.y < viewport.y || pos.y > viewport.y + viewport.h) return null;
  return <svg width={100} height={100} viewBox="-40 -40 100 100" style={{ position: 'absolute', left: pos.x - 40, top: pos.y - 40, pointerEvents: 'none' }}>
    {age < 15 ? <circle r={10 + press * 24} fill={c.accentSoft} stroke={c.accent} strokeWidth={2} opacity={(1 - press) * 0.6} /> : null}
    <path d="M0 0 L0 32 L8 24 L15 39 L22 35 L15 21 L27 21 Z" fill={c.text} stroke={c.surface} strokeWidth={2} strokeLinejoin="round" />
  </svg>;
};
