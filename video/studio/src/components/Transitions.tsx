// Coordinator: soft dips to paper at chosen scene boundaries (no hard jump between unrelated looks).
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { c, ease } from '../brand/tokens';
import { SCENE_START, type SceneId } from '../timeline';

const DIPS: Array<{ into: SceneId; out: number; in: number }> = [{ into: 'close', out: 12, in: 15 }];

export const Transitions: React.FC = () => {
  const f = useCurrentFrame();
  let o = 0;
  for (const d of DIPS) {
    const at = SCENE_START[d.into];
    o = Math.max(
      o,
      interpolate(f, [at - d.out, at, at + d.in], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease }),
    );
  }
  if (o <= 0) return null;
  return <AbsoluteFill style={{ background: c.bg, opacity: o, pointerEvents: 'none' }} />;
};
