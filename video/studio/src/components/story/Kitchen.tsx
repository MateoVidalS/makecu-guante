import React from 'react';
import { c } from '../../brand/tokens';

// A few quiet architectural lines place Rosa at home. The mug is animated separately.
export const Kitchen: React.FC = () => (
  <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden>
    <g fill="none" stroke={c.borderControl} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1430 170 H1758 V470 H1430 Z M1594 170 V470 M1430 320 H1758" />
      <path d="M0 832 H1920 V1080 H0 Z" fill={c.surface2} stroke="none" />
      <path d="M96 832 H1824" stroke={c.text} strokeWidth={6} />
    </g>
  </svg>
);
