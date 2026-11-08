import React from 'react';
import { useCurrentFrame } from 'remotion';
import { c, radius, safe, space } from '../brand/tokens';
import { Fill, Lockup, Mark, T } from '../components/brand';
import { Hand } from '../components/story/Hand';
import { HardwareTurntable } from '../components/story/HardwarePlaceholder';
import { progress } from '../components/story/motion';
import { Landmarks, Waveform } from '../components/story/Signals';
import { Wordmark } from '../components/story/Wordmark';
import { COPY } from '../script';

export const Reveal: React.FC = () => {
  const f = useCurrentFrame();
  const triad = [COPY.reveal.watches, COPY.reveal.coaches, COPY.reveal.helps];
  const settle = progress(f, 36);
  const markSize = 240 - settle * 120;
  return (
    <Fill>
      {f < 96 ? (
        <>
          <div style={{ position: 'absolute', left: 840 - settle * 75, top: 250 + settle * 70, opacity: progress(f, 0, 9) }}>
            <Mark size={markSize} tile={progress(f, 0)} ghost={progress(f, 9)} reach={progress(f, 21)} />
          </div>
          <div style={{ position: 'absolute', left: 925, top: 320, opacity: progress(f, 42) }}><Wordmark height={120} /></div>
          <T size="h2" w={400} style={{ position: 'absolute', left: 0, right: 0, top: 488, textAlign: 'center', opacity: progress(f, 51) }}>{COPY.reveal.tagline}</T>
        </>
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
