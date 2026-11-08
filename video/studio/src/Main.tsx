import React from 'react';
import { AbsoluteFill, Series } from 'remotion';
import { AudioLayer, useVoDurations } from './audio/AudioLayer';
import { c } from './brand/tokens';
import { CaptionLayer } from './components/media';
import { SCENE_COMPONENTS } from './scenes';
import { SCENES, sceneFrames } from './timeline';

export const Main: React.FC = () => {
  const durations = useVoDurations();
  return (
    <AbsoluteFill style={{ background: c.bg }}>
      <Series>
        {SCENES.map((s) => {
          const Scene = SCENE_COMPONENTS[s.id];
          return (
            <Series.Sequence key={s.id} durationInFrames={sceneFrames(s)} name={s.title}>
              <Scene />
            </Series.Sequence>
          );
        })}
      </Series>
      <CaptionLayer durations={durations} />
      <AudioLayer />
    </AbsoluteFill>
  );
};
