import React from 'react';
import { evolvePath } from '@remotion/paths';
import { interpolate, useCurrentFrame } from 'remotion';
import { c, ease, radius, safe, space, weight } from '../brand/tokens';
import { Fill, T } from '../components/brand';
import { COPY } from '../script';

const enter = (frame: number, start: number, duration = 12) => interpolate(frame, [start, start + duration], [0, 1], {
  extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
});

const nodes = [
  { title: 'Webcam', x: 96, width: 220 },
  { title: 'MediaPipe', x: 376, width: 260 },
  { title: 'Session engine', sub: '(browser)', x: 696, width: 410 },
  { title: 'Web Serial', x: 1166, width: 260 },
  { title: 'ESP32', sub: 'Safety lives here', x: 1486, width: 330 },
];
const lines = [
  'M316 472 L376 472', 'M636 472 L696 472', 'M1106 472 L1166 472', 'M1426 472 L1486 472',
  'M901 544 L901 648', 'M1651 544 L1651 624',
];

const SystemStrip: React.FC<{ frame: number }> = ({ frame }) => (
  <>
    <T size="small" w={400} color={c.muted} style={{ position: 'absolute', left: safe.x, top: 304 }}>From camera to movement</T>
    <svg width={1920} height={900} style={{ position: 'absolute', inset: 0 }} aria-label="Camera to ESP32 system diagram">
      {lines.map((path, i) => (
        <path key={path} d={path} fill="none" stroke={c.borderStrong} strokeWidth={2}
          {...evolvePath(enter(frame, 24 + i * 4, 4), path)} />
      ))}
      {nodes.slice(1).map((node, i) => (
        <path key={node.title} d={`M${node.x - 9} 466 L${node.x - 2} 472 L${node.x - 9} 478`}
          fill="none" stroke={c.borderStrong} strokeWidth={2} opacity={enter(frame, 28 + i * 4, 4)} />
      ))}
    </svg>
    {nodes.map((node, i) => (
      <div key={node.title} style={{
        position: 'absolute', left: node.x, top: 400, width: node.width, height: 144,
        boxSizing: 'border-box', border: `${i === 4 ? 3 : 1}px solid ${i === 4 ? c.brand : c.border}`,
        borderRadius: radius.card, background: c.surface, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: space.s8, opacity: enter(frame, 12 + i * 4),
      }}>
        <T size="h3">{node.title}</T>
        {node.sub && <T size="small" w={400} color={i === 4 ? c.brand : c.muted}>{node.sub}</T>}
      </div>
    ))}
    <div style={{ position: 'absolute', left: 716, top: 648, width: 370, height: 128, border: `1px solid ${c.border}`,
      borderRadius: radius.card, background: c.surface, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: space.s8, opacity: enter(frame, 44) }}>
      <T size="h3">Gemini</T>
      <T size="small" w={400} color={c.muted}>Coach, summaries</T>
    </div>
    <T size="small" w={400} color={c.muted} style={{ position: 'absolute', left: 1440, top: 648, width: 420,
      textAlign: 'center', lineHeight: 1.5, opacity: enter(frame, 48) }}>
      5 micro servos<br />Current sensor · stop button
    </T>
  </>
);

const SafetyLayers: React.FC<{ frame: number }> = ({ frame }) => (
  <>
    {COPY.underHood.layers.map((layer, i) => {
      const progress = enter(frame, 144 + i * 18);
      return (
        <div key={layer.title} style={{ position: 'absolute', left: safe.x + (i % 2) * 880, top: 304 + Math.floor(i / 2) * 256,
          width: 848, height: 224, boxSizing: 'border-box', background: c.surface,
          border: `1px solid ${c.border}`, borderRadius: radius.card, padding: space.s32,
          opacity: progress, transform: `translateY(${(1 - progress) * 12}px)` }}>
          <div style={{ position: 'absolute', left: space.s32, top: space.s32, width: space.s64, height: space.s64,
            borderRadius: radius.pill, background: c.text, display: 'grid', placeItems: 'center' }}>
            <T size="body" color={c.surface}>{i + 1}</T>
          </div>
          <div style={{ marginLeft: 80 }}>
            <T size="h3" style={{ marginBottom: space.s16 }}>{layer.title}</T>
            <T size="body" w={400} color={c.muted} style={{ maxWidth: 672, textWrap: 'balance' }}>{layer.sub}</T>
          </div>
        </div>
      );
    })}
  </>
);

const Numbers: React.FC<{ frame: number }> = ({ frame }) => (
  <div style={{ position: 'absolute', left: safe.x, right: safe.x, top: 376, display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr', gap: space.s48 }}>
    {COPY.underHood.numbers.map((number, i) => {
      // All three settle together at f360, the next 72-frame bar boundary.
      const progress = enter(frame, 330 + i * 6, 30 - i * 6);
      const target = Number(number.value.replace(/[^\d]/g, ''));
      const count = Math.round(target * progress);
      const value = number.value.replace(String(target), String(count));
      return (
        <div key={number.label} style={{ opacity: enter(frame, 330 + i * 6), textAlign: 'center' }}>
          <T size="hero" style={{ whiteSpace: 'nowrap', marginBottom: space.s24 }}>{value}</T>
          <T size="body" w={weight.regular} color={c.muted} style={{ maxWidth: 490, margin: 'auto' }}>{number.label}</T>
        </div>
      );
    })}
  </div>
);

export const UnderHood: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Fill>
      {frame < 330 ? <>
        <T size="h1" style={{ position: 'absolute', top: 152, left: safe.x, right: safe.x, opacity: enter(frame, 0) }}>{COPY.underHood.title}</T>
        {frame < 144 ? <SystemStrip frame={frame} /> : <SafetyLayers frame={frame} />}
      </> : <Numbers frame={frame} />}
    </Fill>
  );
};
