import React from 'react';
import { Freeze, Sequence } from 'remotion';
import { c } from '../brand/tokens';
import { Fill } from '../components/brand';
import { Callout } from '../components/screen/Callout';
import { FootageSlot } from '../components/screen/FootageSlot';
import { ScreenFrame } from '../components/screen/ScreenFrame';

export const Coach: React.FC = () => {
  const app = { x: 940, y: 96, w: 884, h: 720 };
  const team = { x: 96, y: 96, w: 796, h: 720 };
  return <Fill style={{ clipPath: 'inset(64px 0 200px 0)' }}>
    <Sequence durationInFrames={300} layout="none">
      <ScreenFrame clip="coach-panel" fit="cover" sourceRegion="focus:coach-source" area={app} camera={[
        { at: 0, target: 'focus:coach-tight', zoom: 1.7 },
        { at: 18, target: 'focus:coach-tight', zoom: 1.8 },
      ]}>
        <Callout point="click:Undo" label="Undo" dotColor={c.target} side="right" at={36} until={138} position={{ x: 1500, y: 680 }} />
      </ScreenFrame>
    </Sequence>
    <Sequence from={300} durationInFrames={150} layout="none">
      <ScreenFrame clip="coach-panel" from={300} sourceRegion="focus:coach-dialog-source" area={app} camera={[{ at: 0, target: 'focus:coach-dialog-body', zoom: 1 }]} />
    </Sequence>
    <Sequence from={450} durationInFrames={54} layout="none">
      <ScreenFrame clip="coach-panel" from={450} fit="cover" sourceRegion="focus:coach-source" area={app} camera={[{ at: 0, target: 'focus:coach-tight', zoom: 1.8 }]} />
    </Sequence>
    <Sequence durationInFrames={144} layout="none"><Freeze frame={0}><FootageSlot id="coach-talk" area={team} /></Freeze></Sequence>
    <Sequence from={144} durationInFrames={324} layout="none"><FootageSlot id="coach-talk" audio area={team} /></Sequence>
    <Sequence from={468} durationInFrames={36} layout="none"><Freeze frame={323}><FootageSlot id="coach-talk" area={team} /></Freeze></Sequence>
  </Fill>;
};
