// The judging criterion of the current scene, as a quiet eyebrow at the top-left, plus five dots for progress.
import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { c, ease, font, type, weight } from '../brand/tokens';
import { CHAPTER, CRITERIA, SCENE_START, SCENES, sceneFrames } from '../timeline';

export const Chapters: React.FC = () => {
  const f = useCurrentFrame();
  const scene = SCENES.find((s) => f >= SCENE_START[s.id] && f < SCENE_START[s.id] + sceneFrames(s));
  const crit = scene ? CHAPTER[scene.id] : undefined;
  if (!scene || !crit) return null;
  // Fade in only when the criterion changes from the previous scene.
  const idx = SCENES.indexOf(scene);
  const prev = idx > 0 ? CHAPTER[SCENES[idx - 1].id] : undefined;
  const local = f - SCENE_START[scene.id];
  const next = SCENES[idx + 1] ? CHAPTER[SCENES[idx + 1].id] : undefined;
  const end = sceneFrames(scene);
  const tIn = prev === crit ? 1 : interpolate(local, [6, 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const tOut = next === crit ? 1 : interpolate(local, [end - 9, end], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const n = CRITERIA.indexOf(crit);
  return (
    <div
      style={{
        position: 'absolute',
        left: 96,
        top: 28,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        opacity: Math.min(tIn, tOut) * 0.9,
        fontFamily: font,
        fontSize: type.caption,
        fontWeight: weight.semibold,
        color: c.muted,
        pointerEvents: 'none',
      }}
    >
      <div style={{ display: 'flex', gap: 5 }}>
        {CRITERIA.map((k, i) => (
          <span key={k} style={{ width: 7, height: 7, borderRadius: 4, background: i <= n ? c.brand : c.surface3 }} />
        ))}
      </div>
      <span>{crit}</span>
    </div>
  );
};
