// Isolated review entry point. Does not register extra compositions in the launch video.
import '@fontsource-variable/atkinson-hyperlegible-next';
import React from 'react';
import { Composition, registerRoot, useCurrentFrame } from 'remotion';
import { c, safe, space } from '../../brand/tokens';
import { Badge, Fill, T } from '../brand';
import { HardwareStill, HardwareTurntable } from './Hardware';

const Angles: React.FC = () => (
  <Fill>
    <T size="h1" style={{ position: 'absolute', left: safe.x, top: safe.y }}>The printed parts.</T>
    <Badge kind="illustrative" style={{ position: 'absolute', left: safe.x, top: 184 }} />
    <div style={{ position: 'absolute', top: 312, display: 'flex', gap: space.s16 }}>
      {[-0.7, 0.6, 2.4].map((turn, i) => <div key={turn}>
        <HardwareStill turn={turn} width={624} height={560} />
        <T size="small" color={c.muted} w={400} style={{ textAlign: 'center' }}>View {i + 1} · {turn.toFixed(1)} rad</T>
      </div>)}
    </div>
  </Fill>
);

const Single: React.FC<{ explode: number; turn: number }> = ({ explode, turn }) => {
  const frame = useCurrentFrame();
  return (
  <Fill>
    <div style={{ position: 'absolute', left: safe.x, top: 248 }}>
      <HardwareTurntable explode={explode} turn={turn + frame * 0.004} width={1728} height={720} />
    </div>
    <T size="h1" style={{ position: 'absolute', left: safe.x, top: safe.y }}>Built around five fingers.</T>
    <Badge kind="illustrative" style={{ position: 'absolute', left: safe.x, top: 184 }} />
    <T size="small" w={400} color={c.muted} style={{ position: 'absolute', left: safe.x, bottom: safe.y }}>Wrist module · lid · 5 spools · dorsal guides · 5 fingertip anchors</T>
  </Fill>
  );
};

const Motion: React.FC = () => {
  const frame = useCurrentFrame();
  return <HardwareTurntable explode={frame / 71} turn={-0.35 + frame * 0.004} />;
};

registerRoot(() => <>
  <Composition id="hardware-angles" component={Angles} durationInFrames={1} fps={30} width={1920} height={1080} />
  <Composition id="hardware-single" component={Single} defaultProps={{ explode: 1, turn: -0.35 }} durationInFrames={72} fps={30} width={1920} height={1080} />
  <Composition id="hardware-motion" component={Motion} durationInFrames={72} fps={30} width={1920} height={1080} />
</>);
