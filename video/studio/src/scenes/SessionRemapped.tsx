// Coordinator: plays the Session scene through the time remap (narration at 1x, transitions faster).
import React from 'react';
import { Freeze, useCurrentFrame } from 'remotion';
import { Session } from './Session';
import { sessionSourceFrame } from './sessionRemap';

export const SessionRemapped: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Freeze frame={Math.round(sessionSourceFrame(f))}>
      <Session />
    </Freeze>
  );
};
