import React from 'react';
import { interpolateColors, useCurrentFrame } from 'remotion';
import { c, safe, space } from '../brand/tokens';
import { Fill, Lockup, T, Words } from '../components/brand';
import { MugInteraction } from '../components/story/MugInteraction';
import { progress } from '../components/story/motion';
import { StoryNote } from '../components/story/StoryNote';
import { useJson } from '../components/useJson';
import type { MusicManifest } from '../contracts';
import { COPY } from '../script';
import { TEAM } from '../team';

export const Close: React.FC = () => {
  const f = useCurrentFrame();
  const music = useJson<MusicManifest>('audio/music/manifest.json');
  const active = progress(f, 24, 42) * 0.85;
  const assisted = progress(f, 66, 18);
  // An 18-frame green hold, including frame 90 in the coordinator's 1 fps sheet.
  // Fade to skin before the grasp begins at frame 114; the palm never changes color.
  const reached = f >= 90 && f < 108;
  const fingerFill = reached ? c.reached : f >= 108 && f < 114
    ? interpolateColors(progress(f + 1, 108, 6), [0, 1], [c.reached, c.hand])
    : f >= 66 && f < 90 ? c.assist : f >= 24 && f < 90 ? c.active : undefined;
  const endEnter = progress(f, 144);
  return (
    <Fill>
      {f < 144 ? (
        <>
          <MugInteraction openness={active + assisted * 0.15} approach={progress(f, 108, 18)} grasp={progress(f, 114, 18)} lift={progress(f, 126) * 12} ghost={progress(f, 6) * (1 - progress(f, 84, 6))} fingerFill={fingerFill} />
          <div style={{ position: 'absolute', left: safe.x, top: safe.y, width: 1400 }}>
            <Words text={COPY.close.tagline} start={0} stagger={4} size="display" />
          </div>
          <StoryNote />
        </>
      ) : (
        <>
          <div style={{ position: 'absolute', left: safe.x, top: 0, bottom: 0, right: safe.x, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', opacity: endEnter, transform: `translateY(${(1 - endEnter) * 12}px)` }}>
            <Lockup height={120} />
            <T size="h1" style={{ marginTop: space.s48 }}>{COPY.close.line}</T>
            <div style={{ display: 'flex', gap: space.s64, marginTop: space.s64 }}>
              {TEAM.map((person) => <div key={person.name} style={{ textAlign: 'center' }}><T size="h3">{person.name}</T>{person.role && <T size="small" w={400} color={c.muted} style={{ marginTop: space.s8 }}>{person.role}</T>}</div>)}
            </div>
            <T size="body" w={400} color={c.muted} style={{ marginTop: space.s64 }}>{COPY.close.event}</T>
          </div>
          <div style={{ position: 'absolute', left: safe.x + space.s64, right: safe.x + space.s64, bottom: safe.y, textAlign: 'center', opacity: progress(f, 162) }}>
            <T size="caption" w={400} color={c.muted}>{COPY.close.disclaimer}</T>
            {music?.credit && <T size="caption" w={400} color={c.muted} style={{ marginTop: space.s16 }}>{music.credit}</T>}
          </div>
        </>
      )}
    </Fill>
  );
};
