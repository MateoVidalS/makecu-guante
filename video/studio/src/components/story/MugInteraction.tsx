import React from 'react';
import { c } from '../../brand/tokens';
import { Hand } from './Hand';
import { Kitchen } from './Kitchen';

const wrist = (x: number, y: number): React.CSSProperties => ({
  position: 'absolute', left: x - 175 * 1.35, top: y - 420 * 1.35,
  width: 320 * 1.35, height: 430 * 1.35,
  transform: 'rotate(70deg)', transformOrigin: `${175 * 1.35}px ${420 * 1.35}px`,
});

const Mug: React.FC<{ lift: number }> = ({ lift }) => (
  <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} role="img" aria-label="Rosa's coffee mug">
    <g transform={`translate(0 ${-lift})`} stroke={c.text} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1412 710 H1435 Q1472 710 1472 749 Q1472 788 1412 784" fill="none" />
      <path d="M1268 680 Q1340 705 1412 680 V812 Q1412 832 1392 832 H1288 Q1268 832 1268 812 Z" fill={c.surface} />
      <ellipse cx="1340" cy="680" rx="72" ry="14" fill={c.chrome} />
      <path d="M1340 644 C1320 624 1358 612 1340 590" fill="none" stroke={c.muted} strokeWidth={3} />
    </g>
  </svg>
);

export const MugInteraction: React.FC<{
  openness: number;
  reach?: number;
  approach?: number;
  grasp?: number;
  lift?: number;
  ghost?: number;
  fingerFill?: string;
  effort?: number;
}> = ({ openness, reach = 1, approach = 0, grasp = 0, lift = 0, ghost = 0, fingerFill, effort = 0 }) => {
  const pose = wrist(730 + reach * 100 + approach * 190 + effort, 880 - reach * 30 - approach * 12 - lift);
  return (
    <>
      <Kitchen />
      <div style={pose}>
        {ghost > 0 && <Hand openness={1} side="left" ghost style={{ position: 'absolute', inset: 0, opacity: ghost }} />}
        <Hand openness={openness} side="left" grasp={grasp} fingerFill={fingerFill} armLength={800} style={{ position: 'absolute', inset: 0 }} />
      </div>
      <Mug lift={lift} />
      {/* The cup occludes the fingers. Only their tips and the thumb cross its front. */}
      {grasp > 0 && (
        <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: Math.max(0, (grasp - 0.65) / 0.35) }} aria-hidden>
          <g transform={`translate(0 ${-lift})`} fill={c.hand} stroke={c.text} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round">
            {[710, 751, 790, 817].map((y) => <path key={y} d={`M1412 ${y - 11} Q1389 ${y - 13} 1389 ${y} Q1389 ${y + 13} 1412 ${y + 11} Z`} />)}
            <path d="M1259 696 Q1277 689 1289 706 L1307 737 Q1311 748 1299 753 Q1288 757 1281 745 L1259 722 Q1249 706 1259 696 Z" />
          </g>
        </svg>
      )}
    </>
  );
};
