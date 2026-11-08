import React from 'react';
import { useCurrentFrame } from 'remotion';
import { c, safe, space, type } from '../brand/tokens';
import { Fill, T, Words } from '../components/brand';
import { Hand } from '../components/story/Hand';
import { progress } from '../components/story/motion';
import { COPY, VO } from '../script';

const firstAt = VO.find((line) => line.id === 'problem-1')!.at;
const openingAt = VO.find((line) => line.id === 'problem-2')!.at;
const statAt = VO.find((line) => line.id === 'problem-3')!.at;
const statValue = Number.parseInt(COPY.problem.stat, 10);

export const Problem: React.FC = () => {
  const f = useCurrentFrame();
  const stat = f >= statAt;
  const b = COPY.problem.b.split(' ');
  return (
    <Fill>
      {stat ? (
        <>
          <div style={{ position: 'absolute', left: safe.x, top: 172, width: 820 }}>
            <T size="hero" style={{ fontSize: 260 }}>{Math.round(statValue * progress(f, statAt, 24))}%</T>
            <T size="h2" w={400} style={{ marginTop: space.s32 }}>{COPY.problem.statLabel}</T>
            <div style={{ height: 1, background: c.border, marginTop: space.s64, marginBottom: space.s24 }} />
            <T size="caption" w={400} color={c.muted}>{COPY.problem.citation}</T>
          </div>
        </>
      ) : (
        <>
          <div style={{ position: 'absolute', left: safe.x, top: 150, width: 960 }}>
            <Words text={COPY.problem.a} start={firstAt} stagger={4} size="display" w={400} />
            <div style={{ marginTop: space.s64, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0.28em', fontSize: type.display }}>
              <div style={{ position: 'relative', opacity: progress(f, openingAt, 9) }}>
                <T size="display">{b[0]}</T>
                <svg width="100%" height="18" viewBox="0 0 354 18" preserveAspectRatio="none" style={{ position: 'absolute', left: 0, bottom: -15 }} aria-hidden>
                  <path d="M4 12 Q160 3 350 9" fill="none" stroke={c.text} strokeWidth={6} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - progress(f, openingAt + 9, 15)} />
                </svg>
              </div>
              <Words text={b.slice(1).join(' ')} start={openingAt + 4} stagger={4} size="display" w={400} />
            </div>
          </div>
        </>
      )}
      <div style={{ position: 'absolute', left: 1100, top: 130, width: 520, height: 699 }}>
        <Hand openness={1} side="left" ghost style={{ position: 'absolute', inset: 0, opacity: progress(f, statAt) }} />
        <Hand openness={0.08 * progress(f, openingAt, 24)} side="left" style={{ position: 'absolute', inset: 0 }} />
      </div>
    </Fill>
  );
};
