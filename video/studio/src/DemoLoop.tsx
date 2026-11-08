// Silent 52 s loop for the screen at the demo table. Reuses the film's scenes; big captions; starts and ends on the
// same title card so it loops seamlessly. Render with --muted.
import React from 'react';
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from 'remotion';
import { c, ease, font, radius } from './brand/tokens';
import { Mark } from './components/brand';
import { Wordmark } from './components/story/Wordmark';
import { Bench } from './scenes/Bench';
import { Coach } from './scenes/Coach';
import { Build } from './scenes/Build';
import { Doctor } from './scenes/Doctor';
import { SessionRemapped } from './scenes/SessionRemapped';

export const LOOP_FRAMES = 1560;

const Title: React.FC = () => (
  <AbsoluteFill style={{ background: c.bg, fontFamily: font, alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
      <Mark size={150} />
      <Wordmark height={112} />
    </div>
    <div style={{ marginTop: 56, color: c.text, fontWeight: 600, fontSize: 84, letterSpacing: '-0.015em' }}>Your hand remembers.</div>
    <div style={{ marginTop: 20, color: c.muted, fontWeight: 400, fontSize: 40 }}>Try first. memo helps with the rest.</div>
  </AbsoluteFill>
);

// A scene, started `offset` frames into itself.
const Clip: React.FC<{ offset: number; children: React.ReactNode }> = ({ offset, children }) => (
  <Sequence from={-offset} layout="none">
    {children}
  </Sequence>
);

const Caption: React.FC<{ text: string; len: number }> = ({ text, len }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [8, 20, len - 14, len - 4], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 64, display: 'flex', justifyContent: 'center', opacity: o, transform: `translateY(${(1 - o) * 10}px)` }}>
      <div style={{ background: 'rgba(26,29,33,0.9)', color: '#fff', borderRadius: radius.card, padding: '20px 40px', fontFamily: font, fontWeight: 600, fontSize: 52, maxWidth: 1600, textAlign: 'center' }}>
        {text}
      </div>
    </div>
  );
};

// Soft dip to paper at both ends of every segment.
const Dip: React.FC<{ len: number }> = ({ len }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 8, len - 8, len], [1, 0, 0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  return <AbsoluteFill style={{ background: c.bg, opacity: o, pointerEvents: 'none' }} />;
};

type Seg = { len: number; node: React.ReactNode; caption?: string; dip?: boolean };

const SEGMENTS: Seg[] = [
  { len: 90, node: <Title /> },
  { len: 210, node: <Clip offset={0}><Bench /></Clip>, caption: 'It helps the hand open.', dip: true },
  { len: 210, node: <Clip offset={60}><Build /></Clip>, caption: '5 servos · ESP32 · current sensor', dip: true },
  { len: 270, node: <Clip offset={120}><SessionRemapped /></Clip>, caption: 'Try first. memo helps with the rest.', dip: true },
  { len: 300, node: <Clip offset={156}><Coach /></Clip>, caption: 'Ask the Gemini coach for help. It answers.', dip: true },
  { len: 180, node: <Clip offset={700}><SessionRemapped /></Clip>, caption: 'Resist, and it lets go.', dip: true },
  { len: 210, node: <Clip offset={290}><Doctor /></Clip>, caption: 'Therapists ask Gemini about the record.', dip: true },
  { len: 90, node: <Title /> },
];

export const DemoLoop: React.FC = () => {
  let at = 0;
  return (
    <AbsoluteFill style={{ background: c.bg }}>
      {SEGMENTS.map((s, i) => {
        const from = at;
        at += s.len;
        return (
          <Sequence key={i} from={from} durationInFrames={s.len}>
            <AbsoluteFill>{s.node}</AbsoluteFill>
            {s.caption ? <Caption text={s.caption} len={s.len} /> : null}
            {s.dip ? <Dip len={s.len} /> : null}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
