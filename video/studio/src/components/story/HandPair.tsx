import React from 'react';
import { Hand } from './Hand';

// The wrists share a table plane in both scenes; only the poses and reach change.
export const HandPair: React.FC<{
  openness: number; reach: number; childEnter?: number; ghost?: number;
  fill?: string; fingerFill?: string; effort?: number;
}> = ({ openness, reach, childEnter = 1, ghost = 0, fill, fingerFill, effort = 0 }) => (
  <>
    <div style={{ position: 'absolute', left: 420 + reach * 100 + effort, top: 326 - reach * 26, width: 448, height: 602, transform: `rotate(${48 - reach * 18}deg)`, transformOrigin: '55% 83%' }}>
      {ghost > 0 && <div style={{ position: 'absolute', inset: 0, opacity: ghost }}><Hand openness={1} side="left" ghost /></div>}
      <Hand openness={openness} side="left" fill={fill} fingerFill={fingerFill} />
    </div>
    <div style={{ position: 'absolute', left: 1020 - reach * 190 + (1 - childEnter) * 850, top: 378 - reach * 36, width: 360, height: 484, transform: `rotate(${-32 + reach * 6}deg)`, transformOrigin: '50% 83%' }}>
      <Hand openness={1} side="right" person="grandson" />
    </div>
  </>
);
