// Owner: coordinator. Completion: the real hardware working (footage/bench-real.mp4, filmed by the team).
import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { c, ease, radius } from '../brand/tokens';
import { T } from '../components/brand';
import { TeamFootage } from '../components/media';
import { BAR, FPS } from '../timeline';

const Label: React.FC = () => {
  const f = useCurrentFrame();
  const t = interpolate(f, [6, 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  return (
    <div style={{ position: 'absolute', right: 96, top: 72, opacity: t, background: c.surface, borderRadius: radius.card, padding: '12px 20px' }}>
      <T size="small">Real hardware · app → ESP32 → 5 servos</T>
    </div>
  );
};

export const Bench: React.FC = () => (
  <>
    <TeamFootage
      id="bench-real"
      label="It works: the real board and servos"
      durationS={(3 * BAR) / FPS}
      notes={[
        'One continuous shot, phone on a tripod: laptop with the app on the left, the board and the 5 servos on the right.',
        'A hand opens at the webcam and the threads wind and pay out over the back of the fingers. Then press Brake: everything releases.',
        'Keep the servo sound. Landscape, 30 fps, 7 s.',
      ]}
    />
    <Label />
  </>
);
