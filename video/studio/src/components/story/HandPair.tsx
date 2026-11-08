import React from 'react';
import { Hand } from './Hand';

// Anchor transforms at the wrists, keeping the two arm silhouettes separate.
const wrist = (x: number, y: number, scale: number, angle: number, right = false): React.CSSProperties => ({
  position: 'absolute', left: x - (right ? 145 : 175) * scale, top: y - 420 * scale,
  width: 320 * scale, height: 430 * scale,
  transform: `rotate(${angle}deg)`, transformOrigin: `${(right ? 145 : 175) * scale}px ${420 * scale}px`,
});

export const HandPair: React.FC<{
  openness: number; reach: number; childEnter?: number; ghost?: number;
  fingerFill?: string; effort?: number; highFive?: boolean;
}> = ({ openness, reach, childEnter = 1, ghost = 0, fingerFill, effort = 0, highFive = false }) => (
  <>
    <div style={wrist(730 + reach * 50 + effort, 870 - reach * 20, 1.4, 50)}>
      {ghost > 0 && <div style={{ position: 'absolute', inset: 0, opacity: ghost }}><Hand openness={1} side="left" ghost /></div>}
      <Hand openness={openness} side="left" fingerFill={fingerFill} armLength={600} style={{ position: 'absolute', inset: 0 }} />
    </div>
    <div style={wrist(1330 - reach * (highFive ? 30 : 170) + (1 - childEnter) * 650, 380 + reach * (highFive ? -50 : 70) - (1 - childEnter) * 650, 1.125, 190, true)}>
      <Hand openness={1} side="right" person="grandson" armLength={800} />
    </div>
  </>
);
