import React from 'react';
import { useCurrentFrame } from 'remotion';
import { c, safe, space } from '../brand/tokens';
import { Fill, Lockup, T, Words } from '../components/brand';
import { HandPair } from '../components/story/HandPair';
import { Kitchen } from '../components/story/Kitchen';
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
  const assisted = progress(f, 72, 18);
  const reached = f >= 108 && f < 120;
  const fingerFill = reached ? c.reached : f >= 72 && f < 108 ? c.assist : f >= 24 && f < 108 ? c.active : undefined;
  const endEnter = progress(f, 144);
  return (
    <Fill>
      {f < 144 ? (
        <>
          <Kitchen />
          <div style={{ position: 'absolute', left: safe.x, top: safe.y, width: 1400 }}>
            <Words text={COPY.close.tagline} start={0} stagger={4} size="display" />
          </div>
          <HandPair openness={active + assisted * 0.15} reach={progress(f, 84, 18)} ghost={progress(f, 6) * (1 - progress(f, 108, 12))} fingerFill={fingerFill} highFive />
          <StoryNote />
        </>
      ) : (
        <>
          <div style={{ position: 'absolute', left: safe.x, top: 152, right: safe.x, display: 'flex', alignItems: 'center', flexDirection: 'column', opacity: endEnter, transform: `translateY(${(1 - endEnter) * 12}px)` }}>
            <Lockup height={96} />
            <T size="h2" w={400} style={{ marginTop: space.s48 }}>{COPY.close.line}</T>
            <div style={{ display: 'flex', gap: space.s64, marginTop: space.s64 }}>
              {TEAM.map((person) => <div key={person.name} style={{ textAlign: 'center' }}><T size="body">{person.name}</T><T size="small" w={400} color={c.muted} style={{ marginTop: space.s8 }}>{person.role}</T></div>)}
            </div>
            <T size="small" w={400} color={c.muted} style={{ marginTop: space.s64 }}>{COPY.close.event}</T>
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
