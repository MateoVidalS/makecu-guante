// Owner: coordinator. Cold open: the three of us to camera (footage/team-intro.mp4 when it exists).
import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { c, ease, radius } from '../brand/tokens';
import { T } from '../components/brand';
import { TeamFootage } from '../components/media';
import { TEAM } from '../team';
import { BAR, FPS } from '../timeline';

// One row of name tags, bottom-left, in on the first beat and out before the hard cut.
const Names: React.FC = () => {
  const f = useCurrentFrame();
  const dur = 3 * BAR;
  return (
    <div style={{ position: 'absolute', left: 96, bottom: 96, display: 'flex', gap: 16 }}>
      {TEAM.map((m, i) => {
        const t = interpolate(f, [12 + i * 6, 24 + i * 6, dur - 30, dur - 18], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
        return (
          <div key={m.name} style={{ opacity: t, transform: `translateY(${(1 - t) * 12}px)`, background: c.surface, borderRadius: radius.card, padding: '14px 24px', display: 'flex', gap: 14, alignItems: 'center' }}>
            <div style={{ width: 6, alignSelf: 'stretch', background: c.brand, borderRadius: 3 }} />
            <div>
              <T size="h3">{m.name}</T>
              {m.role ? (
                <T size="small" w={400} color={c.muted}>
                  {m.role}
                </T>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const Team: React.FC = () => (
  <>
    <TeamFootage
      id="team-intro"
      label="Cold open: the three of us"
      durationS={(3 * BAR) / FPS}
      notes={[
        'All three in frame, to camera, eye level, daylight from the front. Landscape, 4K or 1080p, 30 fps.',
        '"Hi, I\'m Matías, Martín and Mateo, and we didn\'t sleep a lot last night. And this is why:"',
        'Say it in under 6.5 s, end on "why:" and hold still 0.5 s (the hard cut lands there). Shoot 3 takes.',
      ]}
    />
    <Names />
  </>
);
