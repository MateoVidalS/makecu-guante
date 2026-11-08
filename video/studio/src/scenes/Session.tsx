import React from 'react';
import { interpolate, Sequence, useCurrentFrame } from 'remotion';
import { c, ease, safe } from '../brand/tokens';
import { useVoDurations } from '../audio/AudioLayer';
import { Fill, Words } from '../components/brand';
import { Callout } from '../components/screen/Callout';
import { CurrentTrace } from '../components/screen/CurrentTrace';
import { FootageSlot } from '../components/screen/FootageSlot';
import { ScreenFrame } from '../components/screen/ScreenFrame';
import { InnovationSplit } from '../components/screen/InnovationSplit';
import { VisionInset } from '../components/screen/VisionInset';
import { COPY } from '../script';

export const Session: React.FC = () => {
  const frame = useCurrentFrame();
  const durations = useVoDurations();
  const legendDuration = Math.min(durations['session-4'] ?? 216, 216);
  const legend = interpolate(frame, [612, 636], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const innovation = interpolate(frame, [96, 120], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const sidePanel = Math.max(innovation, legend);
  return <Fill style={{ clipPath: 'inset(64px 0 0 0)' }}>
    <Sequence durationInFrames={840} layout="none">
      <ScreenFrame clip="session-main" area={{ x: 64 + 680 * sidePanel, y: 64, w: 1792 - 680 * sidePanel, h: 800 }} playback={[
        { at: 0, event: 'phase:PRESENT', fallback: 0 },
        { at: 144, event: 'phase:ATTEMPT', fallback: 144 },
        { at: 360, event: 'phase:ASSIST', fallback: 360 },
        { at: 540, event: 'phase:ASSIST_HOLD', fallback: 540 },
        { at: 612, event: 'phase:ASSIST_HOLD', fallback: 540, offset: 90 },
        { at: 840, event: 'phase:ASSIST_HOLD', fallback: 540, offset: 120 },
      ]} camera={[
        { at: 0, target: 'focus:virtual-hand', zoom: 1 },
        { at: 36, target: 'focus:virtual-hand', zoom: 1.6 },
        { at: 360, target: 'focus:helped-fingers', zoom: 1.6 },
        { at: 540, target: 'focus:virtual-hand', zoom: 1.6 },
        { at: 612, target: 'focus:hand-and-meters', zoom: 1.2 },
      ]}>
        <Callout point="focus:ghost" label={COPY.session.ghost} dotColor={c.target} side="left" at={40} until={156} position={{ x: 96 + 704 * innovation, y: 180 + 60 * innovation }} />
        <Callout point="focus:solid" label={COPY.session.solid} dotColor={c.hand} side="right" at={70} until={156} position={{ x: 1200 + 100 * innovation, y: 490 + 110 * innovation }} />
        <Callout point="focus:index" label={COPY.session.blue} dotColor={c.active} side="left" at={162} until={342} position={{ x: 96, y: 180 }} />
        <Callout point="focus:helped-fingers" label={COPY.session.orange} dotColor={c.assist} side="right" at={378} until={540} position={{ x: 1190, y: 270 }} />
        <Callout point="focus:virtual-hand" label={COPY.session.green} dotColor={c.reached} side="right" at={552} until={612} position={{ x: 1200, y: 450 }} />
        <Callout point="focus:virtual-hand" label={COPY.session.blue} dotColor={c.active} side="left" at={612} until={840} position={{ x: 96, y: 240 }} pulseAt={612} leader={false} />
        <Callout point="focus:virtual-hand" label={COPY.session.orange} dotColor={c.assist} side="left" at={612} until={840} position={{ x: 96, y: 360 }} pulseAt={612 + legendDuration * 3 / 12} leader={false} />
        <Callout point="focus:virtual-hand" label={COPY.session.green} dotColor={c.reached} side="left" at={612} until={840} position={{ x: 96, y: 480 }} pulseAt={612 + legendDuration * 7 / 12} leader={false} />
      </ScreenFrame>
    </Sequence>
    <InnovationSplit />
    <Sequence from={120} durationInFrames={480} layout="none"><FootageSlot id="session-hand" area={{ x: frame >= 162 && frame < 342 ? 1344 : 96, y: 600, w: 480, h: 270 }} /></Sequence>
    <Sequence from={162} durationInFrames={180} layout="none"><VisionInset /></Sequence>
    <Sequence from={840} durationInFrames={312} layout="none">
      <ScreenFrame clip="session-resist" playback={[
        { at: 0, event: 'phase:ATTEMPT', fallback: 0 },
        { at: 60, event: 'phase:ASSIST', fallback: 60 },
        { at: 168, event: 'mark:resistance:index', fallback: 168 },
        { at: 216, event: 'phase:RELEASE', fallback: 216 },
        { at: 312, event: 'phase:RELEASE', fallback: 216, offset: 75 },
      ]} camera={[
        { at: 0, target: 'focus:virtual-hand', zoom: 1.3 },
        { at: 36, target: 'focus:index', zoom: 2 },
        { at: 168, target: 'focus:safety-and-coach', zoom: 1.05 },
      ]}>
        <Callout point="focus:index" label="Index" dotColor={c.active} side="left" at={36} until={168} position={{ x: 96, y: 180 }} />
      </ScreenFrame>
      <Sequence from={60} durationInFrames={234} layout="none"><CurrentTrace at={0} releaseAt={108} /></Sequence>
    </Sequence>
    <Sequence from={1152} durationInFrames={144} layout="none">
      <Fill><Words text={COPY.session.resist} size="display" stagger={2} style={{ position: 'absolute', left: safe.x, top: 350, maxWidth: 1640 }} /></Fill>
    </Sequence>
  </Fill>;
};
