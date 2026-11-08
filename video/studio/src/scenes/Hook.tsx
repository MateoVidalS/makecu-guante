import React from 'react';
import { useCurrentFrame } from 'remotion';
import { safe } from '../brand/tokens';
import { Fill, Words } from '../components/brand';
import { MugInteraction } from '../components/story/MugInteraction';
import { progress } from '../components/story/motion';
import { StoryNote } from '../components/story/StoryNote';
import { COPY } from '../script';

export const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const effort = f >= 98 && f < 132 ? Math.sin((f - 98) * 0.65) * 1.5 : 0;
  const openness = 0.13 * progress(f, 90) * (1 - progress(f, 132));
  return (
    <Fill>
      <MugInteraction openness={openness} reach={progress(f, 36, 36)} effort={effort} />
      <div style={{ position: 'absolute', left: safe.x, top: safe.y, width: 1140 }}>
        <Words text={COPY.hook.line1} start={6} stagger={5} size="display" />
      </div>
      <StoryNote />
    </Fill>
  );
};
