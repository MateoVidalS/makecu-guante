import React from 'react';
import { Sequence, useCurrentFrame } from 'remotion';
import { c } from '../brand/tokens';
import { Fill } from '../components/brand';
import { Callout } from '../components/screen/Callout';
import { FootageSlot } from '../components/screen/FootageSlot';
import { ScreenFrame } from '../components/screen/ScreenFrame';

export const Coach: React.FC = () => {
  const frame = useCurrentFrame();
  return <Fill style={{ clipPath: 'inset(64px 0 0 0)' }}>
    {frame < 144 ? <ScreenFrame clip="coach-panel" cursor={false} area={{ x: 96, y: 96, w: 600, h: 750 }} camera={[
      { at: 0, target: 'focus:index', zoom: 1.8 },
      { at: 18, target: 'focus:index', zoom: 2.2 },
    ]} /> : null}
    <ScreenFrame clip="coach-panel" fit="cover" area={frame >= 468 ? { x: 96, y: 96, w: 1728, h: 750 } : frame >= 144 ? { x: 940, y: 96, w: 884, h: 750 } : { x: 744, y: 96, w: 1080, h: 750 }} camera={[
      { at: 0, target: 'focus:coach-decision', zoom: 1.6 },
      { at: 18, target: 'focus:coach-decision', zoom: 1.8 },
      { at: 300, target: 'focus:coach-timeline', zoom: 1.6 },
      { at: 450, target: 'focus:coach-decision', zoom: 1.8 },
    ]}>
      {frame < 144 ? <Callout point="click:Undo" label="Undo" dotColor={c.target} side="right" at={36} until={138} position={{ x: 1500, y: 680 }} /> : null}
    </ScreenFrame>
    <Sequence from={144} durationInFrames={324} layout="none"><FootageSlot id="coach-talk" audio area={{ x: 96, y: 96, w: 796, h: 750 }} /></Sequence>
  </Fill>;
};
