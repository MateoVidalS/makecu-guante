import React from 'react';
import { c, safe, space } from '../../brand/tokens';
import { COPY } from '../../script';
import { Badge, T } from '../brand';

export const StoryNote: React.FC = () => (
  <div style={{ position: 'absolute', left: safe.x, bottom: safe.y, display: 'flex', alignItems: 'center', gap: space.s24, background: c.surface2, paddingRight: space.s16 }}>
    <Badge kind="illustrative" />
    <T size="caption" w={400} color={c.muted}>{COPY.hook.note}</T>
  </div>
);
