// Owner: coordinator. Cold open: the three of us to camera (footage/team-intro.mp4).
// Subtle fades: in from black at the start, out to paper right before the hook.
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { c, ease } from '../brand/tokens';
import { TeamFootage } from '../components/media';
import { BAR, FPS } from '../timeline';

const DUR = 3 * BAR;

export const Team: React.FC = () => {
  const f = useCurrentFrame();
  const fromBlack = interpolate(f, [0, 8], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const toPaper = interpolate(f, [DUR - 10, DUR], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  return (
    <AbsoluteFill>
      <TeamFootage
        id="team-intro"
        label="Cold open: the three of us"
        durationS={DUR / FPS}
        notes={['"Hi everyone. I\'m Matías. I\'m Martín. I\'m Mateo, and yesterday night we didn\'t sleep. And the reason? Here\'s why."']}
      />
      <AbsoluteFill style={{ background: '#000', opacity: fromBlack }} />
      <AbsoluteFill style={{ background: c.bg, opacity: toPaper }} />
    </AbsoluteFill>
  );
};
