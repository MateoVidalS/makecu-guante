import React from 'react';
import { Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { c, ease, font, radius, type, weight } from '../brand/tokens';

// ---- Logo (never typeset "memo" as a logo) ----------------------------------------------------

export const Lockup: React.FC<{ height: number; tone?: 'ink' | 'white'; style?: React.CSSProperties }> = ({
  height,
  tone = 'ink',
  style,
}) => <Img src={staticFile(`brand/memo-lockup-${tone}.svg`)} style={{ height, width: 'auto', ...style }} />;

// The mark, drawn here (not as an <Img>) so the reveal can animate its two layers:
// the faint taller m is the TARGET (ghost), the solid m is YOU reaching up toward it.
export const Mark: React.FC<{ size: number; ghost?: number; reach?: number; tile?: number }> = ({
  size,
  ghost = 1, // 0..1 opacity of the faint m
  reach = 1, // 0..1 how far the solid m has risen (0 = 6 units lower)
  tile = 1, // 0..1 tile opacity
}) => {
  const dy = (1 - reach) * 6;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="memo">
      <rect width="48" height="48" rx="11" fill={c.brand} opacity={tile} />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 33V15.5a6 6 0 0 1 12 0V33M24 15.5a6 6 0 0 1 12 0V33" stroke="#FFF" strokeOpacity={0.4 * ghost} strokeWidth={4} />
        <g transform={`translate(0 ${dy})`}>
          <path d="M12 37V27a6 6 0 0 1 12 0v10M24 27a6 6 0 0 1 12 0v10" stroke={c.brand} strokeWidth={10} />
          <path d="M12 37V27a6 6 0 0 1 12 0v10M24 27a6 6 0 0 1 12 0v10" stroke="#FFF" strokeWidth={4.5} />
        </g>
      </g>
    </svg>
  );
};

// ---- Badges: honesty labels. Required on every simulated / demo / illustrative frame ----------

export type BadgeKind = 'simulated' | 'demoData' | 'illustrative';

const BADGE_TEXT: Record<BadgeKind, string> = {
  simulated: 'Simulated glove and camera',
  demoData: 'Demo data',
  illustrative: 'Illustrative scene',
};

export const Badge: React.FC<{ kind: BadgeKind; style?: React.CSSProperties }> = ({ kind, style }) => {
  const isDemo = kind !== 'illustrative';
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 16px',
        borderRadius: radius.input,
        background: isDemo ? c.demoSoft : c.surface2,
        color: isDemo ? c.demoText : c.muted,
        border: `1px solid ${isDemo ? c.demo : c.border}`,
        fontFamily: font,
        fontWeight: weight.semibold,
        fontSize: type.caption,
        ...style,
      }}
    >
      <span style={{ width: 10, height: 10, borderRadius: 5, background: isDemo ? c.demo : c.target }} />
      {BADGE_TEXT[kind]}
    </div>
  );
};

// ---- Text ---------------------------------------------------------------------------------------

export const T: React.FC<{
  size: keyof typeof type;
  w?: 400 | 600;
  color?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ size, w = 600, color = c.text, style, children }) => (
  <div
    style={{
      fontFamily: font,
      fontSize: type[size],
      fontWeight: w,
      color,
      lineHeight: size === 'hero' || size === 'display' ? 1.05 : 1.2,
      letterSpacing: size === 'hero' || size === 'display' ? '-0.015em' : 0,
      fontVariantNumeric: 'tabular-nums',
      ...style,
    }}
  >
    {children}
  </div>
);

// Word-by-word reveal: each word rises 12 px and fades in with the brand ease. No overshoot.
export const Words: React.FC<{
  text: string;
  start?: number;
  stagger?: number; // frames between words
  size?: keyof typeof type;
  w?: 400 | 600;
  color?: string;
  // Words that get a color, e.g. { open: c.assistText } — only when that color MEANS that state.
  colorize?: Record<string, string>;
  style?: React.CSSProperties;
}> = ({ text, start = 0, stagger = 3, size = 'display', w = 600, color = c.text, colorize = {}, style }) => {
  const frame = useCurrentFrame();
  const words = text.split(' ');
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: Math.round(type[size] * 0.27), ...style }}>
      {words.map((word, i) => {
        const t = interpolate(frame - start - i * stagger, [0, 9], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
        const key = word.replace(/[.,!?]/g, '').toLowerCase();
        return (
          <T key={i} size={size} w={w} color={colorize[key] ?? color} style={{ opacity: t, transform: `translateY(${(1 - t) * 12}px)` }}>
            {word}
          </T>
        );
      })}
    </div>
  );
};

export const Fill: React.FC<{ bg?: string; children?: React.ReactNode; style?: React.CSSProperties }> = ({ bg = c.bg, children, style }) => (
  <div style={{ position: 'absolute', inset: 0, background: bg, fontFamily: font, overflow: 'hidden', ...style }}>{children}</div>
);
