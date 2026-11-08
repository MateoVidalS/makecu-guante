import React from 'react';
import { Sequence } from 'remotion';
import { c, safe } from '../brand/tokens';
import { Fill, T, Words } from '../components/brand';
import { ScreenFrame } from '../components/screen/ScreenFrame';
import { SourceHighlight } from '../components/screen/SourceHighlight';
import { COPY } from '../script';

export const Doctor: React.FC = () => <Fill style={{ clipPath: 'inset(64px 0 200px 0)' }}>
  <Sequence durationInFrames={200} layout="none">
    <ScreenFrame clip="doctor-history" card="focus:history-card" camera={[]} playback={[{ at: 0, event: 'focus:then-now-demo-data', fallback: 0, offset: 270 }]} />
  </Sequence>
  <Sequence from={200} durationInFrames={72} layout="none">
    <ScreenFrame clip="doctor-replay" card="focus:position-card" camera={[]} />
  </Sequence>
  <Sequence from={272} durationInFrames={28} layout="none">
    <ScreenFrame clip="doctor-replay" from={72} card="focus:current-card" camera={[]} />
  </Sequence>
  <Sequence from={300} durationInFrames={260} layout="none">
    <ScreenFrame clip="doctor-summary" from={72} cursor={false} card="focus:summary-card" camera={[]}>
      <SourceHighlight target="focus:summary-sentence" at={60} />
    </ScreenFrame>
  </Sequence>
  <Sequence from={560} durationInFrames={40} layout="none">
    <ScreenFrame clip="doctor-export" from={48} card="focus:export-card" camera={[]} />
  </Sequence>
  <Sequence from={600} durationInFrames={120} layout="none">
    <Fill>
      <Words text={COPY.doctor.honest} size="display" stagger={2} style={{ position: 'absolute', left: safe.x, top: 300, maxWidth: 1700 }} />
      <T size="h2" w={400} color={c.muted} style={{ position: 'absolute', left: safe.x, top: 460, maxWidth: 1530 }}>Honest numbers for the people who guide you.</T>
    </Fill>
  </Sequence>
</Fill>;
