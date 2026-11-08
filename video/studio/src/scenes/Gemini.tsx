import React from 'react';
import { useCurrentFrame } from 'remotion';
import { safe } from '../brand/tokens';
import { Badge, Fill, T } from '../components/brand';
import { BoundedCall, MotorBoundary, SpeechFlow, Uses } from '../components/gemini/Diagram';
import { enter } from '../components/gemini/primitives';
import { COPY } from '../script';

export const Gemini: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Fill>
      <Badge kind="illustrative" style={{ position: 'absolute', top: safe.y, right: safe.x }} />
      <T size="h1" style={{ position: 'absolute', top: 152, left: safe.x, right: safe.x, opacity: enter(frame, 0) }}>
        {COPY.gemini.title}
      </T>
      {frame < 132 ? <SpeechFlow frame={frame} />
        : frame < 252 ? <BoundedCall frame={frame} />
          : frame < 318 ? <MotorBoundary frame={frame} />
            : <Uses frame={frame} />}
    </Fill>
  );
};
