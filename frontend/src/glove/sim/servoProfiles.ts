import type { GloveFinger } from '../../contracts/glove';

export interface ServoProfile {
  model: string;
  idle_ma: number;
  moving_ma: number;
  stall_ma: number;
  max_speed_deg_s: number;
}

// Mirror F1's firmware/include/config.h. ALL values are provisional at 5 V and
// must be measured on the actual hardware, including identifying the thumb.
// Speeds describe the physical servo; firmware command ramp limits still apply.
export const SERVO_PROFILES: Readonly<
  Record<GloveFinger, Readonly<ServoProfile>>
> = Object.freeze({
  thumb: Object.freeze({
    model: 'Unknown thumb (identify on bench)',
    idle_ma: 20,
    moving_ma: 250,
    stall_ma: 650,
    max_speed_deg_s: 300,
  }),
  index: Object.freeze({
    model: 'TowerPro SG92R',
    idle_ma: 20,
    moving_ma: 300,
    stall_ma: 800,
    max_speed_deg_s: 600,
  }),
  middle: Object.freeze({
    model: 'MG90S',
    idle_ma: 20,
    moving_ma: 250,
    stall_ma: 750,
    max_speed_deg_s: 500,
  }),
  ring: Object.freeze({
    model: 'Smraza S51',
    idle_ma: 15,
    moving_ma: 200,
    stall_ma: 650,
    max_speed_deg_s: 500,
  }),
  pinky: Object.freeze({
    model: 'Smraza S51',
    idle_ma: 15,
    moving_ma: 200,
    stall_ma: 650,
    max_speed_deg_s: 500,
  }),
});
