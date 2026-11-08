import React from 'react';
import { Sequence } from 'remotion';
import { c, safe } from '../brand/tokens';
import { Fill, T, Words } from '../components/brand';
import { ScreenFrame } from '../components/screen/ScreenFrame';
import { SourceHighlight } from '../components/screen/SourceHighlight';
import { COPY } from '../script';

export const Doctor: React.FC = () => <Fill style={{ clipPath: 'inset(64px 0 0 0)' }}>
  <Sequence durationInFrames={200} layout="none">
    <ScreenFrame clip="doctor-history" camera={[
      { at: 0, target: 'focus:then-now', zoom: 1.15 },
      { at: 36, target: 'focus:then-now', zoom: 2 },
    ]} />
  </Sequence>
  <Sequence from={200} durationInFrames={100} layout="none">
    <ScreenFrame clip="doctor-replay" camera={[
      { at: 0, target: 'focus:vision-servo', zoom: 1.1 },
      { at: 66, target: 'focus:current', zoom: 1.8 },
    ]} />
  </Sequence>
  <Sequence from={300} durationInFrames={260} layout="none">
    <ScreenFrame clip="doctor-summary" from={72} cursor={false} camera={[
      { at: 0, target: 'focus:summary', zoom: 1.4 },
      { at: 54, target: 'focus:summary-sentence', zoom: 1.8 },
    ]}>
      <SourceHighlight target="focus:summary-sentence" at={60} />
    </ScreenFrame>
  </Sequence>
  <Sequence from={560} durationInFrames={40} layout="none">
    <ScreenFrame clip="doctor-export" from={48} camera={[
      { at: 0, target: 'focus:export', zoom: 1.65 },
      { at: 18, target: 'focus:export', zoom: 2.2 },
    ]} />
  </Sequence>
  <Sequence from={600} durationInFrames={120} layout="none">
    <Fill>
      <Words text={COPY.doctor.honest} size="display" stagger={2} style={{ position: 'absolute', left: safe.x, top: 300, maxWidth: 1700 }} />
      <T size="h2" w={400} color={c.muted} style={{ position: 'absolute', left: safe.x, top: 460, maxWidth: 1530 }}>Honest numbers for the people who guide you.</T>
    </Fill>
  </Sequence>
</Fill>;
