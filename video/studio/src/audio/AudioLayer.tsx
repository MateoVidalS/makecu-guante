// Owner: V2. Coordinator wrote this first version; V2 refines the mix (ducking curve, SFX, levels).
import React from 'react';
import { Audio, interpolate, Sequence, staticFile } from 'remotion';
import type { MusicManifest, SfxManifest, VoManifest } from '../contracts';
import { useJson } from '../components/useJson';
import { VO } from '../script';
import { SCENE_START, TOTAL_FRAMES } from '../timeline';

export const useVoDurations = (): Record<string, number> => {
  const vo = useJson<VoManifest>('audio/vo/manifest.json');
  return Object.fromEntries((vo?.lines ?? []).map((l) => [l.id, l.durationFrames]));
};

// VO intervals in absolute frames, for ducking.
const voIntervals = (durations: Record<string, number>) =>
  VO.map((l) => {
    const from = SCENE_START[l.scene] + l.at;
    return [from, from + (durations[l.id] ?? l.maxFrames)] as const;
  });

export const AudioLayer: React.FC = () => {
  const vo = useJson<VoManifest>('audio/vo/manifest.json');
  const music = useJson<MusicManifest>('audio/music/manifest.json');
  useJson<SfxManifest>('audio/sfx/manifest.json');
  const durations = Object.fromEntries((vo?.lines ?? []).map((l) => [l.id, l.durationFrames]));
  const intervals = voIntervals(durations);
  const musicGain = (f: number) => {
    const base = music?.cues?.length
      ? interpolate(f, music.cues.map((q) => q.frame), music.cues.map((q) => q.gain), { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
      : 0.5;
    // Duck to 35% under VO with 8-frame ramps.
    const duck = intervals.reduce((d, [a, b]) => Math.min(d, interpolate(f, [a - 8, a, b, b + 8], [1, 0.35, 0.35, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })), 1);
    return base * duck;
  };
  return (
    <>
      {music ? <Audio src={staticFile(music.file)} volume={musicGain} endAt={TOTAL_FRAMES} /> : null}
      {(vo?.lines ?? []).map((l) => {
        const line = VO.find((x) => x.id === l.id);
        if (!line) return null;
        return (
          <Sequence key={l.id} from={SCENE_START[line.scene] + line.at} durationInFrames={l.durationFrames + 2} layout="none">
            <Audio src={staticFile(l.file)} />
          </Sequence>
        );
      })}
    </>
  );
};
