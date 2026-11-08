import React from 'react';
import { c } from '../brand/tokens';
import { Fill, T } from '../components/brand';
import { getScene, type SceneId } from '../timeline';

// Placeholder until the owner lands the scene. Never ships.
export const Stub: React.FC<{ id: SceneId }> = ({ id }) => {
  const s = getScene(id);
  return (
    <Fill>
      <div style={{ position: 'absolute', left: 96, top: 96, right: 96, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <T size="small" w={400} color={c.muted}>
          Scene {id} · owner {s.owner} · {s.bars} bars
        </T>
        <T size="h1">{s.title}</T>
        <T size="body" w={400} color={c.muted} style={{ maxWidth: 1300 }}>
          {s.what}
        </T>
      </div>
    </Fill>
  );
};
