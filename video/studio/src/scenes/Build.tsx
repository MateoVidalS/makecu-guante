import React from 'react';
import { useCurrentFrame } from 'remotion';
import { c, safe } from '../brand/tokens';
import { Fill, T } from '../components/brand';
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
    <div style={{ position: 'absolute', top: 64, left: 0 }}><BuildAssembly frame={frame} width={1920} height={760} /></div>
    <T size="h2" style={{ position: 'absolute', left: safe.x, top: safe.y, color: c.text }}>{step.label}</T>
    <T size="caption" w={400} color={c.muted} style={{ position: 'absolute', left: safe.x, bottom: 216 }}>Model of the printed parts and wiring</T>
  </Fill>;
};
