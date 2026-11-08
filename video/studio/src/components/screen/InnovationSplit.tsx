import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { c, ease, radius, space } from '../../brand/tokens';
import { T } from '../brand';

export const InnovationSplit: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [18, 30, 72, 96], [0, 0.65, 0.65, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  return <div style={{ position: 'absolute', left: 96, top: 180, width: 560, padding: space.s32, boxSizing: 'border-box', borderRadius: radius.card, border: `1px solid ${c.border}`, background: c.surface, opacity }}>
    <T size="h3" color={c.muted}>Moves your hand for you</T>
    <svg width={440} height={300} viewBox="0 0 320 240" style={{ marginTop: space.s24 }} aria-label="Passive hand movement illustration">
      <g fill="none" stroke={c.target} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M90 178V95Q90 84 101 84T112 95V52Q112 41 123 41T134 52V36Q134 25 145 25T156 36V49Q156 38 167 38T178 49V71Q178 60 189 60T200 71V151Q200 187 176 205V224H117V205Q94 195 78 175L56 146Q49 136 59 129T77 132L90 148" />
        <path d="M241 65V151M225 135L241 151L257 135M225 81L241 65L257 81" />
      </g>
    </svg>
  </div>;
};
