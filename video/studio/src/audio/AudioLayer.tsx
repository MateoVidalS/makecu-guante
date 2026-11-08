// Owner: V2. Coordinator wrote this first version; V2 refines the mix (ducking curve, SFX, levels).
import React from 'react';
import { Audio, Sequence, staticFile } from 'remotion';
import type { MusicManifest, VoManifest } from '../contracts';
import { useJson } from '../components/useJson';
import { hasStatic } from '../components/media';
import { VO } from '../script';
import { SCENE_START, TOTAL_FRAMES } from '../timeline';
import { musicGain, type SpeechInterval } from './mix';

export { Sfx } from './Sfx';

export const useVoDurations = (): Record<string, number> => {
  const vo = useJson<VoManifest>('audio/vo/manifest.json');
  return Object.fromEntries((vo?.lines ?? []).map((l) => [l.id, l.durationFrames]));
};

// VO intervals in absolute frames, for ducking.
const voIntervals = (durations: Record<string, number>): SpeechInterval[] =>
  VO.map((l) => {
    const from = SCENE_START[l.scene] + l.at;
    return [from, from + (durations[l.id] ?? l.maxFrames)] as const;
  });

export const AudioLayer: React.FC = () => {
  const vo = useJson<VoManifest>('audio/vo/manifest.json');
  const music = useJson<MusicManifest>('audio/music/manifest.json');
  const durations = Object.fromEntries((vo?.lines ?? []).map((l) => [l.id, l.durationFrames]));
  const intervals = voIntervals(durations);
  // Real footage carries its own dialogue; reserve the same headroom when it
  // arrives. Placeholders have no audio and do not trigger these extra ducks.
  if (hasStatic('footage/team-intro.mp4')) intervals.push([SCENE_START.team, SCENE_START.problem]);
  if (hasStatic('footage/team-next.mp4')) intervals.push([SCENE_START.next, SCENE_START.close]);
  if (hasStatic('footage/coach-talk.mp4')) intervals.push([SCENE_START.coach + 144, SCENE_START.coach + 468]);
  return (
    <>
      {music ? <Audio src={staticFile(music.file)} volume={(frame) => musicGain(frame, music.cues, intervals)} endAt={TOTAL_FRAMES} /> : null}
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
