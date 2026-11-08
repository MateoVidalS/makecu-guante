import React from 'react';
import { interpolate } from 'remotion';
import { c, dur, ease, radius, safe, shadow, space, type } from '../../brand/tokens';
import { T } from '../brand';
import { buildTiming, projectBuildPoint, type Point } from './buildMotion';
import { servoShafts } from './Hardware';

type Callout = {
  id: string; at: number; until: number; label: string; sub: string;
  point: (frame: number) => Point;
  left: number; top: number; width: number; dock: 'left' | 'right' | 'bottom';
};
const drop = (frame: number, at: number, distance: number) => interpolate(frame, [at, at + 12], [distance, 0], {
  extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
});
const [shaftX, shaftY] = servoShafts[0];

export const buildCallouts: Callout[] = [
  { id: 'servos', at: buildTiming.servos, until: buildTiming.spools, label: '5 micro servos', sub: 'SG92R · MG90S · S51',
    point: (f) => [shaftX - 5.5, shaftY, 25.6 + drop(f, buildTiming.servos, 70)],
    left: safe.x, top: 200, width: 440, dock: 'right' },
  { id: 'spools', at: buildTiming.spools, until: 174, label: 'Spools and threads', sub: 'Wind to open, unwind to release',
    point: (f) => [shaftX, shaftY, 35.3 + drop(f, buildTiming.spools, 40)],
    left: safe.x, top: 200, width: 620, dock: 'right' },
  { id: 'esp32', at: buildTiming.esp32, until: buildTiming.stop, label: 'ESP32-WROOM-32', sub: 'Runs the safety rules',
    point: (f) => [-66, -86, 5.2 + drop(f, buildTiming.esp32, 35)],
    left: safe.x, top: 120, width: 520, dock: 'right' },
  { id: 'sensor', at: buildTiming.sensor, until: buildTiming.wiring, label: 'INA219 current sensor', sub: 'Feels every pull, cuts at the limit',
    point: (f) => [-27, -86, 3.9 + drop(f, buildTiming.sensor, 35)],
    left: 1180, top: 530, width: 644, dock: 'left' },
  { id: 'stop', at: buildTiming.stop, until: 248, label: 'Stop button', sub: 'Latches until a person releases it',
    point: (f) => [-3, -86, 7.2 + drop(f, buildTiming.stop, 35)],
    left: safe.x, top: 550, width: 680, dock: 'right' },
  { id: 'guides', at: buildTiming.hand, until: 282, label: 'Black guides · yellow anchors', sub: 'On the back of each finger',
    point: () => [128, 31, 50],
    left: safe.x, top: 100, width: 720, dock: 'bottom' },
];

/** DOM pills stay readable; their leaders follow the animated CAD point through the camera. */
export const BuildCallouts: React.FC<{ frame: number; width: number; height: number }> = ({ frame, width, height }) => (
  <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
    {buildCallouts.filter((callout) => frame >= callout.at && frame < callout.until).map((callout) => {
      const point = projectBuildPoint(frame, width, height, callout.point(frame));
      const line = interpolate(frame - callout.at, [0, dur.fast], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
      const enter = interpolate(frame - callout.at - dur.fast, [0, dur.base], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
      const exit = interpolate(frame, [callout.until - dur.fast, callout.until], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
      const pillHeight = space.s32 * 2 + (type.h3 + type.small) * 1.2 + 2;
      const dock = callout.dock === 'bottom'
        ? { x: callout.left + callout.width / 2, y: callout.top + pillHeight }
        : { x: callout.left + (callout.dock === 'right' ? callout.width : 0), y: callout.top + pillHeight / 2 };
      const elbow = callout.dock === 'bottom' ? { x: dock.x, y: dock.y + space.s32 }
        : { x: dock.x + (callout.dock === 'right' ? space.s48 : -space.s48), y: dock.y };
      return <React.Fragment key={callout.id}>
        <svg width={width} height={height} style={{ position: 'absolute', inset: 0, opacity: exit }} aria-hidden>
          <path d={`M ${point.x} ${point.y} L ${elbow.x} ${elbow.y} L ${dock.x} ${dock.y}`}
            fill="none" stroke={c.text} strokeWidth={1} strokeLinecap="round" strokeLinejoin="round"
            pathLength={1} strokeDasharray={1} strokeDashoffset={1 - line} />
          <circle cx={point.x} cy={point.y} r={space.s8 / 2} fill={c.text} opacity={line} />
        </svg>
        <div style={{ position: 'absolute', left: callout.left, top: callout.top, width: callout.width,
          boxSizing: 'border-box', padding: `${space.s32}px`, borderRadius: radius.pill,
          border: `1px solid ${c.border}`, background: c.surface, boxShadow: shadow,
          opacity: enter * exit, transform: `translateY(${(1 - enter) * space.s8}px)` }}>
          <T size="h3" style={{ whiteSpace: 'nowrap' }}>{callout.label}</T>
          <T size="small" w={400} color={c.muted} style={{ whiteSpace: 'nowrap' }}>{callout.sub}</T>
        </div>
      </React.Fragment>;
    })}
  </div>
);
