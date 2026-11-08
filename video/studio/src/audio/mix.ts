import type { MusicManifest } from '../contracts';
import { FPS } from '../timeline';

export const DUCK_GAIN = 10 ** (-10 / 20);
export const DUCK_RAMP_FRAMES = Math.round(0.2 * FPS);
export const SFX_BUS_GAIN = 0.5;
export type SpeechInterval = readonly [number, number];

export function cueGain(frame: number, cues: MusicManifest['cues']): number {
  if (!cues?.length) return 0.5;
  if (frame <= cues[0].frame) return cues[0].gain;
  for (let i = 1; i < cues.length; i++) {
    const a = cues[i - 1];
    const b = cues[i];
    if (frame <= b.frame) {
      const t = (frame - a.frame) / (b.frame - a.frame);
      return a.gain + (b.gain - a.gain) * t;
    }
  }
  return cues[cues.length - 1].gain;
}

export function duckGain(frame: number, intervals: readonly SpeechInterval[]): number {
  return intervals.reduce((gain, [start, end]) => {
    const distance = frame < start ? start - frame : frame > end ? frame - end : 0;
    const t = Math.min(1, distance / DUCK_RAMP_FRAMES);
    return Math.min(gain, DUCK_GAIN + (1 - DUCK_GAIN) * t);
  }, 1);
}

export function musicGain(frame: number, cues: MusicManifest['cues'], intervals: readonly SpeechInterval[]): number {
  return cueGain(frame, cues) * duckGain(frame, intervals);
}
