import React from 'react';
import { getStaticFiles, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { c, ease, font, radius, type, weight } from '../brand/tokens';
import { VO, type VoLine } from '../script';
import { SCENE_START, type SceneId } from '../timeline';
import { Fill, T } from './brand';

export const hasStatic = (path: string) => getStaticFiles().some((f) => f.name === path);

// ---- Team footage slot ------------------------------------------------------------------------
// Drop the real clip at public/footage/<id>.mp4 and it replaces the placeholder automatically.
export const TeamFootage: React.FC<{ id: string; label: string; notes: string[]; durationS: number }> = ({ id, label, notes, durationS }) => {
  const file = `footage/${id}.mp4`;
  if (hasStatic(file)) return <OffthreadVideo src={staticFile(file)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
  return (
    <Fill bg={c.chrome}>
      <div style={{ position: 'absolute', inset: 48, border: `3px dashed ${cDarkLine}`, borderRadius: radius.card, padding: 64, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <T size="small" color={c.target} w={400}>
          Team footage · drop footage/{id}.mp4 · {durationS.toFixed(1)} s
        </T>
        <T size="h1" color={c.onChrome}>
          {label}
        </T>
        {notes.map((n) => (
          <T key={n} size="body" color={c.target} w={400}>
            {n}
          </T>
        ))}
      </div>
    </Fill>
  );
};
const cDarkLine = '#5A6675'; // placeholder-only dashed line on slate (not shipped in the final cut)

// ---- Lower third (names on team shots) ---------------------------------------------------------
export const LowerThird: React.FC<{ name: string; role: string; from: number; dur: number }> = ({ name, role, from, dur }) => {
  const f = useCurrentFrame() - from;
  const t = interpolate(f, [0, 12, dur - 12, dur], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  if (f < 0 || f > dur) return null;
  return (
    <div style={{ position: 'absolute', left: 96, bottom: 96, opacity: t, transform: `translateX(${(1 - t) * -16}px)` }}>
      <div style={{ background: c.surface, borderRadius: radius.card, padding: '18px 28px', display: 'flex', gap: 20, alignItems: 'center' }}>
        <div style={{ width: 6, alignSelf: 'stretch', background: c.brand, borderRadius: 3 }} />
        <div>
          <T size="h3">{name}</T>
          <T size="small" w={400} color={c.muted}>
            {role}
          </T>
        </div>
      </div>
    </div>
  );
};

// ---- Captions (burned-in subtitles for every VO line) ------------------------------------------
// Atkinson 600 on an ink card, bottom center, max 2 lines. The coach's voice gets a "Coach" chip.
export const CaptionLayer: React.FC<{ durations: Record<string, number> }> = ({ durations }) => (
  <>
    {VO.map((line) => {
      const from = SCENE_START[line.scene] + line.at;
      const len = Math.min(durations[line.id] ?? line.maxFrames, line.maxFrames) + 6;
      return (
        <Sequence key={line.id} from={from} durationInFrames={len} layout="none">
          <Caption line={line} len={len} />
        </Sequence>
      );
    })}
  </>
);

const Caption: React.FC<{ line: VoLine; len: number }> = ({ line, len }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 6, len - 6, len], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 56, display: 'flex', justifyContent: 'center', opacity: o, pointerEvents: 'none' }}>
      <div
        style={{
          maxWidth: 1280,
          background: 'rgba(26,29,33,0.88)',
          color: '#fff',
          borderRadius: radius.card,
          padding: '14px 28px',
          fontFamily: font,
          fontWeight: weight.semibold,
          fontSize: type.body,
          lineHeight: 1.3,
          textAlign: 'center',
          display: 'flex',
          gap: 14,
          alignItems: 'center',
        }}
      >
        {line.voice === 'coach' ? (
          <span style={{ fontSize: type.caption, background: c.brand, borderRadius: radius.sm, padding: '4px 10px', whiteSpace: 'nowrap' }}>memo coach</span>
        ) : null}
        <span>{line.text}</span>
      </div>
    </div>
  );
};

// Captions are global (Main). Scenes rendered alone get them via <SceneCaptions scene=…/>.
export const SceneCaptions: React.FC<{ scene: SceneId; durations: Record<string, number> }> = ({ scene, durations }) => (
  <>
    {VO.filter((l) => l.scene === scene).map((line) => {
      const len = Math.min(durations[line.id] ?? line.maxFrames, line.maxFrames) + 6;
      return (
        <Sequence key={line.id} from={line.at} durationInFrames={len} layout="none">
          <Caption line={line} len={len} />
        </Sequence>
      );
    })}
  </>
);
