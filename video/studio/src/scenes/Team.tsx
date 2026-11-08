// Owner: coordinator. The founders on camera (footage/team-intro.mp4 when it exists).
import React from 'react';
import { LowerThird, TeamFootage } from '../components/media';
import { TEAM } from '../team';
import { BAR, FPS } from '../timeline';

export const Team: React.FC = () => (
  <>
    <TeamFootage
      id="team-intro"
      label="The three of us, to camera"
      durationS={(4 * BAR) / FPS}
      notes={[
        'One shot, all three in frame, eye level, daylight from the front.',
        'Each says one line, six words or fewer: "We are memo." / "We help hands open again." / "We built it in two days."',
        'Shoot it 3 times; landscape 4K or 1080p.',
      ]}
    />
    {TEAM.map((m, i) => (
      <LowerThird key={m.name} name={m.name} role={m.role} from={24 + i * BAR} dur={BAR - 6} />
    ))}
  </>
);
