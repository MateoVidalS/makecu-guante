// Owner: coordinator. The founders say what comes next (footage/team-next.mp4 when it exists).
import React from 'react';
import { TeamFootage } from '../components/media';
import { BAR, FPS } from '../timeline';

export const Next: React.FC = () => (
  <TeamFootage
    id="team-next"
    label="What is next"
    durationS={(4 * BAR) / FPS}
    notes={[
      'One of us to camera, hardware on the table in the background.',
      '"Next: the bench safety gate. Then a pilot with therapists."',
      'Honest: the glove has not been tested on a person yet.',
    ]}
  />
);
