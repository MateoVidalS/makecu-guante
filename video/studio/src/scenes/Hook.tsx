import React from 'react';
import { useCurrentFrame } from 'remotion';
import { c, radius, safe, space } from '../brand/tokens';
import { Fill, T, Words } from '../components/brand';
import { HandPair } from '../components/story/HandPair';
import { Kitchen } from '../components/story/Kitchen';
import { progress } from '../components/story/motion';
import { StoryNote } from '../components/story/StoryNote';
import { COPY } from '../script';

export const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const effort = f >= 76 && f < 108 ? Math.sin((f - 76) * 0.65) * 1.5 : 0;
  const openness = 0.13 * progress(f, 72) * (1 - progress(f, 105));
  return (
    <Fill>
      <Kitchen />
      <div style={{ position: 'absolute', left: safe.x, top: safe.y, width: 1140 }}>
        <Words text={COPY.hook.line1} start={6} stagger={5} size="display" />
      </div>
      <HandPair openness={openness} reach={progress(f, 114, 24)} childEnter={progress(f, 40, 24)} effort={effort} />
      <div style={{ position: 'absolute', left: safe.x, bottom: 122, padding: `${space.s16}px ${space.s32}px`, background: c.chrome, borderRadius: radius.pill, opacity: progress(f, 150, 9), transform: `translateY(${(1 - progress(f, 150, 9)) * 12}px)` }}>
        <T size="h2" color={c.onChrome}>{COPY.hook.punch}</T>
      </div>
      <StoryNote />
    </Fill>
  );
};
