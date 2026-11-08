import React from 'react';
import { useCurrentFrame } from 'remotion';
import { c, safe } from '../brand/tokens';
import { Badge, Fill, T } from '../components/brand';
import { BuildAssembly } from '../components/hardware/BuildAssembly';

const steps = [
  { at: 0, label: 'The wrist module.' },
  { at: 18, label: 'Five micro servos.' },
  { at: 108, label: 'A spool on every horn.' },
  { at: 198, label: 'ESP32 · current sensor · stop button.' },
  { at: 216, label: 'Power, ground, signal.' },
  { at: 234, label: 'Lid on.' },
  { at: 252, label: 'Thin threads over the back of each finger.' },
];

export const Build: React.FC = () => {
  const frame = useCurrentFrame();
  const step = [...steps].reverse().find((item) => frame >= item.at)!;
  return <Fill>
    <T size="h3" style={{ position: 'absolute', left: safe.x, top: safe.y, color: c.text }}>{step.label}</T>
    <Badge kind="illustrative" style={{ position: 'absolute', right: safe.x, top: safe.y }} />
    <div style={{ position: 'absolute', top: 144, left: safe.x }}><BuildAssembly frame={frame} width={1728} height={720} /></div>
  </Fill>;
};
