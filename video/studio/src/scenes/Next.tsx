// Owner: coordinator. The founders say what comes next (footage/team-next.mp4 when it exists).
import React from 'react';
import { TeamFootage } from '../components/media';
import { BAR, FPS } from '../timeline';

export const Next: React.FC = () => (
  <TeamFootage
    id="team-next"
    label="What is next"
    durationS={(3 * BAR) / FPS}
    notes={[
      'One of us to camera, the hardware on the table behind.',
      '"It works end to end: camera, coach, board and servos. Next: the safety gate on a real hand, then a pilot with therapists."',
      'Honest: memo has not been tested on a patient yet. Under 6.5 s.',
    ]}
  />
);
