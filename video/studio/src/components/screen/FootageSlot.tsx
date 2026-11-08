import React from 'react';
import { OffthreadVideo, staticFile } from 'remotion';
import { c, radius, shadow, space } from '../../brand/tokens';
import { T } from '../brand';
import { hasStatic } from '../media';
import type { Box } from './camera';

export const FootageSlot: React.FC<{ id: 'session-hand' | 'coach-talk'; area: Box; audio?: boolean }> = ({ id, area, audio = false }) => {
  const path = `footage/${id}.mp4`;
  return <div style={{ position: 'absolute', left: area.x, top: area.y, width: area.w, height: area.h, borderRadius: radius.card, overflow: 'hidden', boxShadow: shadow, background: c.chrome }}>
    {hasStatic(path) ? <OffthreadVideo src={staticFile(path)} muted={!audio} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ position: 'absolute', inset: space.s32, border: `1px solid ${c.target}`, borderRadius: radius.input, padding: space.s24, display: 'flex', justifyContent: 'center', flexDirection: 'column', gap: space.s16 }}>
      <T size={id === 'session-hand' ? 'body' : 'h2'} color={c.onChrome}>{id === 'session-hand' ? 'Hand + glove' : 'A conversation with memo'}</T>
      <T size="caption" w={400} color={c.target}>Team footage pending</T>
      {id === 'coach-talk' ? <T size="caption" w={400} color={c.target}>Live conversation audio plays in this slot.</T> : null}
    </div>}
  </div>;
};
