import React from 'react';
import { Audio, staticFile } from 'remotion';
import { useJson } from '../components/useJson';
import type { SfxManifest } from '../contracts';
import { SFX_BUS_GAIN } from './mix';

export type SfxId = 'click' | 'reached' | 'release';

// Put inside a scene's <Sequence from={eventFrame} layout="none">.
// No sound occurs until a scene explicitly places an event.
export const Sfx: React.FC<{ id: SfxId; volume?: number }> = ({ id, volume = 1 }) => {
  const manifest = useJson<SfxManifest>('audio/sfx/manifest.json');
  const sound = manifest?.sounds.find((entry) => entry.id === id);
  return sound ? <Audio src={staticFile(sound.file)} volume={Math.max(0, Math.min(1, volume)) * SFX_BUS_GAIN} /> : null;
};
