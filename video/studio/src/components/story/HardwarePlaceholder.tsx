import React from 'react';
import { c, radius, space } from '../../brand/tokens';
import { T } from '../brand';

// V4's fixed API. Integration replaces this import with ../hardware/Hardware;
// this deliberately neutral box does not pretend to be a hardware render.
export const HardwareTurntable: React.FC<{
  parts?: Array<'module' | 'lid' | 'spools' | 'guides' | 'anchors'>;
  explode?: number;
  turn?: number;
  width?: number;
  height?: number;
}> = ({ width = 1920, height = 1080 }) => (
  <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ width: '64%', height: '70%', border: `1px solid ${c.border}`, borderRadius: radius.card, background: c.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: space.s24 }}>
      <svg width="240" height="160" viewBox="0 0 240 160" aria-hidden>
        <g fill="none" stroke={c.borderStrong} strokeWidth={3} strokeLinejoin="round">
          <path d="M44 51 L120 20 L196 51 L196 113 L120 144 L44 113 Z M44 51 L120 82 L196 51 M120 82 V144" />
        </g>
      </svg>
      <T size="h3">Hardware preview</T>
      <T size="small" color={c.muted} w={400}>Wrist module · tendon guides · fingertip anchors</T>
    </div>
  </div>
);
