import type { GloveEvent } from '../contracts/glove';

export const BROWNOUT_MESSAGE =
  'The glove board restarted because the 5 V supply dipped. Check the 470-1000 uF capacitor and the supply limit.';

export function boardRestartMessage(
  events: readonly GloveEvent[],
): string | null {
  const latestBoot = [...events].reverse().find((event) => event.e === 'boot');
  return latestBoot?.reset_reason === 9 ? BROWNOUT_MESSAGE : null;
}
