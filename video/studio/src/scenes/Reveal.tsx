import React from 'react';
import { useCurrentFrame } from 'remotion';
import { c, radius, safe, space } from '../brand/tokens';
import { Fill, Lockup, Mark, T } from '../components/brand';
import { Hand } from '../components/story/Hand';
import { HardwareTurntable } from '../components/story/HardwarePlaceholder';
import { progress } from '../components/story/motion';
import { Landmarks, Waveform } from '../components/story/Signals';
import { COPY } from '../script';

export const Reveal: React.FC = () => {
  const f = useCurrentFrame();
  const triad = [COPY.reveal.watches, COPY.reveal.coaches, COPY.reveal.helps];
  return (
    <Fill>
      {f < 96 ? (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 160, display: 'flex', alignItems: 'center', flexDirection: 'column' }}>
          <Mark size={240} tile={progress(f, 0)} ghost={progress(f, 9)} reach={progress(f, 21)} />
          <div style={{ marginTop: space.s48, opacity: progress(f, 36), transform: `translateY(${(1 - progress(f, 36)) * 12}px)` }}><Lockup height={96} /></div>
          <T size="h2" w={400} style={{ marginTop: space.s32, opacity: progress(f, 45) }}>{COPY.reveal.tagline}</T>
        </div>
      ) : f < 216 ? (
        <>
          <div style={{ position: 'absolute', left: safe.x, top: safe.y }}><Lockup height={64} /></div>
          <div style={{ position: 'absolute', left: 160, top: 138 }}>
            <HardwareTurntable width={1600} height={680} turn={(f - 96) / 600} explode={progress(f, 144, 48) * 0.35} />
          </div>
        </>
      ) : (
        <>
          <div style={{ position: 'absolute', left: safe.x, right: safe.x, top: 176, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: space.s24 }}>
            {triad.map((item, i) => {
              const at = 216 + i * 18;
              const enter = progress(f, at, 12);
              return (
                <div key={item.title} style={{ background: c.surface, border: `1px solid ${c.border}`, borderRadius: radius.card, padding: space.s32, height: 620, opacity: enter, transform: `translateY(${(1 - enter) * 12}px)` }}>
                  <div style={{ height: 350, marginBottom: space.s32 }}>
                    {i === 0 ? <Landmarks draw={progress(f, at + 3, 24)} /> : i === 1 ? <Waveform frame={f - at} draw={enter} /> : <Hand openness={progress(f, at, 36)} side="left" fingerFill={c.assist} />}
                  </div>
                  <T size="h1">{item.title}</T>
                  <T size="body" w={400} color={c.muted} style={{ marginTop: space.s24 }}>{item.sub}</T>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Fill>
  );
};
