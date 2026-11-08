import React from 'react';
import { Sequence } from 'remotion';
import { c, safe } from '../brand/tokens';
import { Fill, T, Words } from '../components/brand';
import { ScreenFrame } from '../components/screen/ScreenFrame';
import { SourceHighlight } from '../components/screen/SourceHighlight';
import { COPY } from '../script';

export const Doctor: React.FC = () => <Fill>
  <Sequence durationInFrames={324} layout="none">
    <ScreenFrame clip="doctor-history" camera={[
      { at: 0, target: 'focus:then', zoom: 1.15 },
      { at: 36, target: 'focus:then', zoom: 1.8 },
      { at: 144, target: 'focus:now', zoom: 1.8 },
      { at: 234, target: 'focus:per-finger', zoom: 1.5 },
    ]} />
  </Sequence>
  <Sequence from={324} durationInFrames={144} layout="none">
    <ScreenFrame clip="doctor-replay" camera={[
      { at: 0, target: 'focus:phase-bands', zoom: 1.35 },
      { at: 18, target: 'focus:vision-servo', zoom: 1.6 },
      { at: 90, target: 'focus:current', zoom: 1.5 },
    ]} />
  </Sequence>
  <Sequence from={468} durationInFrames={180} layout="none">
    <ScreenFrame clip="doctor-summary" camera={[
      { at: 0, target: 'focus:summary', zoom: 1 },
      { at: 54, target: 'focus:summary-sentence', zoom: 1.03 },
    ]}>
      <SourceHighlight target="focus:summary-sentence" at={60} />
    </ScreenFrame>
  </Sequence>
  <Sequence from={648} durationInFrames={48} layout="none">
    <ScreenFrame clip="doctor-export" camera={[
      { at: 0, target: 'focus:export', zoom: 1.65 },
      { at: 18, target: 'focus:export', zoom: 2.2 },
    ]} />
  </Sequence>
  <Sequence from={696} durationInFrames={168} layout="none">
    <Fill>
      <Words text={COPY.doctor.honest} size="display" stagger={2} style={{ position: 'absolute', left: safe.x, top: 300, maxWidth: 1700 }} />
      <T size="h2" w={400} color={c.muted} style={{ position: 'absolute', left: safe.x, top: 460, maxWidth: 1530 }}>Honest numbers for the people who guide you.</T>
    </Fill>
  </Sequence>
</Fill>;
