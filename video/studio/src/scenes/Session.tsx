import React from 'react';
import { interpolate, Sequence, useCurrentFrame } from 'remotion';
import { c, ease, safe } from '../brand/tokens';
import { useVoDurations } from '../audio/AudioLayer';
import { Fill, Words } from '../components/brand';
import { Callout } from '../components/screen/Callout';
import { CurrentTrace } from '../components/screen/CurrentTrace';
import { FootageSlot } from '../components/screen/FootageSlot';
import { ScreenFrame } from '../components/screen/ScreenFrame';
import { COPY } from '../script';

export const Session: React.FC = () => {
  const frame = useCurrentFrame();
  const durations = useVoDurations();
  const legendDuration = Math.min(durations['session-4'] ?? 216, 216);
  const legend = interpolate(frame, [612, 636], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  return <Fill>
    <Sequence durationInFrames={840} layout="none">
      <ScreenFrame clip="session-main" area={{ x: 64 + 680 * legend, y: 64, w: 1792 - 680 * legend, h: 800 }} camera={[
        { at: 0, target: 'focus:virtual-hand', zoom: 1 },
        { at: 36, target: 'focus:virtual-hand', zoom: 1.6 },
        { at: 360, target: 'focus:helped-fingers', zoom: 1.6 },
        { at: 540, target: 'focus:virtual-hand', zoom: 1.6 },
        { at: 612, target: 'focus:hand-and-meters', zoom: 1.2 },
      ]}>
        <Callout point="focus:ghost" label={COPY.session.ghost} dotColor={c.target} side="left" at={40} until={156} position={{ x: 96, y: 180 }} />
        <Callout point="focus:solid" label={COPY.session.solid} dotColor={c.hand} side="right" at={70} until={156} position={{ x: 1200, y: 490 }} />
        <Callout point="focus:index" label={COPY.session.blue} dotColor={c.active} side="left" at={162} until={342} position={{ x: 96, y: 180 }} />
        <Callout point="focus:helped-fingers" label={COPY.session.orange} dotColor={c.assist} side="right" at={378} until={540} position={{ x: 1190, y: 270 }} />
        <Callout point="focus:virtual-hand" label={COPY.session.green} dotColor={c.reached} side="right" at={552} until={612} position={{ x: 1200, y: 450 }} />
        <Callout point="focus:virtual-hand" label={COPY.session.blue} dotColor={c.active} side="left" at={612} until={840} position={{ x: 96, y: 240 }} pulseAt={612} leader={false} />
        <Callout point="focus:virtual-hand" label={COPY.session.orange} dotColor={c.assist} side="left" at={612} until={840} position={{ x: 96, y: 360 }} pulseAt={612 + legendDuration * 3 / 12} leader={false} />
        <Callout point="focus:virtual-hand" label={COPY.session.green} dotColor={c.reached} side="left" at={612} until={840} position={{ x: 96, y: 480 }} pulseAt={612 + legendDuration * 7 / 12} leader={false} />
      </ScreenFrame>
    </Sequence>
    <Sequence from={120} durationInFrames={480} layout="none"><FootageSlot id="session-hand" area={{ x: 96, y: 600, w: 480, h: 270 }} /></Sequence>
    <Sequence from={840} durationInFrames={384} layout="none">
      <ScreenFrame clip="session-resist" camera={[
        { at: 0, target: 'focus:virtual-hand', zoom: 1.3 },
        { at: 36, target: 'focus:index', zoom: 2 },
        { at: 168, target: 'focus:safety-and-coach', zoom: 1.05 },
      ]}>
        <Callout point="focus:index" label="Index" dotColor={c.active} side="left" at={36} until={168} position={{ x: 96, y: 180 }} />
      </ScreenFrame>
      <Sequence from={60} durationInFrames={234} layout="none"><CurrentTrace at={0} releaseAt={108} /></Sequence>
    </Sequence>
    <Sequence from={1224} durationInFrames={144} layout="none">
      <Fill><Words text={COPY.session.resist} size="display" stagger={2} style={{ position: 'absolute', left: safe.x, top: 350, maxWidth: 1640 }} /></Fill>
    </Sequence>
  </Fill>;
};
