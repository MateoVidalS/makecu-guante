import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { c, ease, radius, safe, space, weight } from '../brand/tokens';
import { Fill, T } from '../components/brand';
import { COPY } from '../script';

const enter = (frame: number, start: number, duration = 12) => interpolate(frame, [start, start + duration], [0, 1], {
  extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
});

const SafetyLayers: React.FC<{ frame: number }> = ({ frame }) => (
  <>
    {COPY.underHood.layers.map((layer, i) => {
      const progress = enter(frame, 108 + i * 36);
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
      // Settle by f324, then hold through the final beat before the f360 cut.
      const progress = enter(frame, 288 + i * 6, 36 - i * 6);
      const target = Number(number.value.replace(/[^\d]/g, ''));
      const count = Math.round(target * progress);
      const value = number.value.replace(String(target), String(count));
      return (
        <div key={number.label} style={{ opacity: enter(frame, 288 + i * 6), textAlign: 'center' }}>
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
      {frame < 288 ? <>
        <T size="h1" style={{ position: 'absolute', top: 152, left: safe.x, right: safe.x, opacity: enter(frame, 0) }}>{COPY.underHood.title}</T>
        {frame >= 108 && <SafetyLayers frame={frame} />}
      </> : <Numbers frame={frame} />}
    </Fill>
  );
};
