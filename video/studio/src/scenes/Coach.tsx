import React from 'react';
import { Sequence, useCurrentFrame } from 'remotion';
import { c, safe } from '../brand/tokens';
import { Fill, T, Words } from '../components/brand';
import { Callout } from '../components/screen/Callout';
import { FootageSlot } from '../components/screen/FootageSlot';
import { ScreenFrame } from '../components/screen/ScreenFrame';
import { COPY } from '../script';

export const Coach: React.FC = () => {
  const frame = useCurrentFrame();
  return <Fill>
    {frame < 144 ? <ScreenFrame clip="coach-panel" cursor={false} area={{ x: 96, y: 96, w: 600, h: 750 }} camera={[
      { at: 0, target: 'focus:index', zoom: 1.8 },
      { at: 18, target: 'focus:index', zoom: 2.2 },
    ]} /> : null}
    {frame < 474 ? <ScreenFrame clip="coach-panel" area={frame >= 144 ? { x: 940, y: 96, w: 884, h: 750 } : { x: 744, y: 96, w: 1080, h: 750 }} camera={[
      { at: 0, target: 'focus:coach-panel', zoom: 1.9 },
      { at: 18, target: 'focus:coach-decision', zoom: 2.2 },
      { at: 144, target: 'focus:coach-panel', zoom: 2.2 },
    ]}>
      {frame < 144 ? <Callout point="click:Undo" label="Undo" dotColor={c.target} side="right" at={36} until={138} position={{ x: 1500, y: 680 }} /> : null}
    </ScreenFrame> : null}
    <Sequence from={144} durationInFrames={324} layout="none"><FootageSlot id="coach-talk" audio area={{ x: 96, y: 96, w: 796, h: 750 }} /></Sequence>
    <Sequence from={474} durationInFrames={102} layout="none">
      <Fill>
        <Words text={COPY.coach.rule} size="h1" stagger={1} style={{ position: 'absolute', left: safe.x, top: 290, maxWidth: 1570 }} />
        <T size="body" w={400} color={c.muted} style={{ position: 'absolute', left: safe.x, top: 440, maxWidth: 1400 }}>{COPY.coach.sub}</T>
      </Fill>
    </Sequence>
  </Fill>;
};
