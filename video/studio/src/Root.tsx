import '@fontsource-variable/atkinson-hyperlegible-next';
import React from 'react';
import { AbsoluteFill, Composition, Folder } from 'remotion';
import { c } from './brand/tokens';
import { SceneCaptions } from './components/media';
import { useVoDurations } from './audio/AudioLayer';
import { Main } from './Main';
import { SCENE_COMPONENTS } from './scenes';
import { FPS, HEIGHT, SCENES, sceneFrames, TOTAL_FRAMES, WIDTH, type SceneId } from './timeline';

// Each scene is also its own composition (with its captions) so owners can preview and render it alone.
const SceneAlone: React.FC<{ id: SceneId }> = ({ id }) => {
  const Scene = SCENE_COMPONENTS[id];
  const durations = useVoDurations();
  return (
    <AbsoluteFill style={{ background: c.bg }}>
      <Scene />
      <SceneCaptions scene={id} durations={durations} />
    </AbsoluteFill>
  );
};

export const Root: React.FC = () => (
  <>
    <Composition id="Main" component={Main} durationInFrames={TOTAL_FRAMES} fps={FPS} width={WIDTH} height={HEIGHT} />
    <Folder name="Scenes">
      {SCENES.map((s) => (
        <Composition
          key={s.id}
          id={`scene-${s.id}`}
          component={SceneAlone}
          defaultProps={{ id: s.id }}
          durationInFrames={sceneFrames(s)}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
      ))}
    </Folder>
  </>
);
