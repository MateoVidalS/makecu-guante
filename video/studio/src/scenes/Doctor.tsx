// The therapist: history, one replay, the Gemini chat assistant answering from the record, the summary, then the statement.
// 0-200 history · 200-290 replay · 290-500 Gemini chat · 500-600 summary · 600-720 statement.
import React from 'react';
import { Sequence } from 'remotion';
import { c, radius, safe } from '../brand/tokens';
import { Fill, T, Words } from '../components/brand';
import { ScreenFrame } from '../components/screen/ScreenFrame';
import { SourceHighlight } from '../components/screen/SourceHighlight';
import { useJson } from '../components/useJson';
import type { RecordingManifest } from '../contracts';
import { COPY } from '../script';

// The chat recording (V1c). Until it lands, a quiet placeholder keeps the cut reviewable.
const ChatShot: React.FC = () => {
  const manifest = useJson<RecordingManifest>('recordings/manifest.json');
  const clip = manifest?.clips.find((item) => item.id === 'doctor-chat');
  if (clip) {
    const card = clip.events.find((e) => e.label === 'focus:chat-panel' || e.label === 'focus:chat')?.label;
    return <ScreenFrame clip="doctor-chat" card={card} camera={[]} />;
  }
  return (
    <Fill>
      <div style={{ position: 'absolute', left: safe.x, right: safe.x, top: 120, height: 700, border: `1px dashed ${c.borderStrong}`, borderRadius: radius.card, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <T size="h2" color={c.muted} w={400}>
          Doctor chat recording pending (V1c)
        </T>
      </div>
    </Fill>
  );
};

export const Doctor: React.FC = () => (
  <Fill style={{ clipPath: 'inset(64px 0 200px 0)' }}>
    <Sequence durationInFrames={200} layout="none">
      <ScreenFrame clip="doctor-history" card="focus:history-card" camera={[]} playback={[{ at: 0, event: 'focus:then-now-demo-data', fallback: 0, offset: 270 }]} />
    </Sequence>
    <Sequence from={200} durationInFrames={90} layout="none">
      <ScreenFrame clip="doctor-replay" card="focus:position-card" camera={[]} />
    </Sequence>
    <Sequence from={290} durationInFrames={210} layout="none">
      <ChatShot />
    </Sequence>
    <Sequence from={500} durationInFrames={100} layout="none">
      <ScreenFrame clip="doctor-summary" from={72} cursor={false} card="focus:summary-card" camera={[]}>
        <SourceHighlight target="focus:summary-sentence" at={20} />
      </ScreenFrame>
    </Sequence>
    <Sequence from={600} durationInFrames={120} layout="none">
      <Fill>
        <Words text={COPY.doctor.honest} size="display" stagger={2} style={{ position: 'absolute', left: safe.x, top: 300, maxWidth: 1700 }} />
        <T size="h2" w={400} color={c.muted} style={{ position: 'absolute', left: safe.x, top: 460, maxWidth: 1530 }}>
          Honest numbers for the people who guide you.
        </T>
      </Fill>
    </Sequence>
  </Fill>
);
