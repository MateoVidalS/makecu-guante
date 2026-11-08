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
> = Object.freeze(
  Object.fromEntries(
    (['thumb', 'index', 'middle', 'ring', 'pinky'] as const).map((finger) => [
      finger,
      // All five fingers use the same 9 g micro servo (SG90 class, ~1.6-1.8 kg·cm).
      Object.freeze({
        model: 'Smraza S51',
        idle_ma: 15,
        moving_ma: 200,
        stall_ma: 650,
        max_speed_deg_s: 500,
      }),
    ]),
  ) as Record<GloveFinger, Readonly<ServoProfile>>,
);
