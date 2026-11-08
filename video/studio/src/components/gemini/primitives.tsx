import React from 'react';
import { evolvePath } from '@remotion/paths';
import { interpolate } from 'remotion';
import { c, ease, radius, space, type } from '../../brand/tokens';
import { T } from '../brand';

export const enter = (frame: number, start: number, duration = 12) => interpolate(frame, [start, start + duration], [0, 1], {
  extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
});

// Same stack as the app's --font-mono (frontend/src/styles/tokens.css).
export const mono = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

export const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{
    position: 'absolute', boxSizing: 'border-box', background: c.surface,
    border: `1px solid ${c.border}`, borderRadius: radius.card, ...style,
  }}>{children}</div>
);

export const Line: React.FC<{ path: string; progress: number; arrow?: boolean }> = ({ path, progress, arrow = false }) => (
  <svg width={1920} height={900} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden="true">
    <path d={path} fill="none" stroke={c.borderStrong} strokeWidth={2} strokeLinecap="round"
      {...evolvePath(progress, path)} />
    {arrow && progress === 1 && <path d="M-8 -6 L-1 0 L-8 6" fill="none" stroke={c.borderStrong} strokeWidth={2}
      transform={`translate(${path.trim().split(' ').slice(-2).join(' ')})`} />}
  </svg>
);

export type IconName = 'voice' | 'tools' | 'clamp' | 'engine' | 'lock' | 'text' | 'chat' | 'speaker' | 'laptop';

const iconPaths: Record<IconName, React.ReactNode> = {
  voice: <><rect x={9} y={3} width={6} height={11} rx={3} /><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v3M8 21h8" /></>,
  tools: <><path d="m8 5-6 7 6 7M16 5l6 7-6 7M14 3l-4 18" /></>,
  clamp: <><path d="M8 3H3v18h5M16 3h5v18h-5M8 8v8M16 8v8M8 12h8" /></>,
  engine: <><rect x={5} y={5} width={14} height={14} rx={2} /><rect x={9} y={9} width={6} height={6} rx={1} /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></>,
  lock: <><rect x={5} y={10} width={14} height={11} rx={2} /><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3" /></>,
  text: <><path d="M14 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9ZM14 2v7h7M7 13h10M7 17h7" /></>,
  chat: <><path d="M21 15a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3Z" /><path d="M7 8h10M7 12h7" /></>,
  speaker: <><path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8M18 4a11 11 0 0 1 0 16" /></>,
  laptop: <><rect x={4} y={3} width={16} height={13} rx={2} /><path d="m4 16-2 5h20l-2-5M10 18h4" /></>,
};

export const Icon: React.FC<{ name: IconName; size?: number }> = ({ name, size = 48 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c.text}
    strokeWidth={48 / size} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true">
    {iconPaths[name]}
  </svg>
);

export const Waveform: React.FC<{ frame: number }> = ({ frame }) => (
  <svg width={160} height={48} viewBox="0 0 160 48" aria-label="Illustrative audio waveform">
    {Array.from({ length: 19 }, (_, i) => {
      const envelope = Math.sin((i + 1) / 20 * Math.PI);
      const height = 6 + envelope * (12 + 18 * (0.5 + Math.sin(frame * 0.16 - i * 0.72) * 0.5));
      return <line key={i} x1={8 + i * 8} x2={8 + i * 8} y1={24 - height / 2} y2={24 + height / 2}
        stroke={c.brand} strokeWidth={4} strokeLinecap="round" />;
    })}
  </svg>
);

export const ToolGrid: React.FC<{ tools: readonly string[]; frame: number; start: number; columns?: number; style?: React.CSSProperties }> = ({
  tools, frame, start, columns = 5, style,
}) => (
  <div style={{ position: 'absolute', display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: space.s16, ...style }}>
    {tools.map((tool, i) => (
      <div key={tool} style={{
        background: c.surface2, border: `1px solid ${c.border}`, borderRadius: radius.input,
        padding: `${space.s16}px ${space.s16}px`, opacity: enter(frame, start + Math.floor(i / columns) * 6),
      }}>
        <T size="small" w={400} style={{ fontFamily: mono, fontSize: type.small, whiteSpace: 'nowrap' }}>{tool}</T>
      </div>
    ))}
  </div>
);
