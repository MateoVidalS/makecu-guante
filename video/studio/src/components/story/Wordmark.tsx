import React from 'react';
import { Lockup } from '../brand';

// Crop the coordinator-owned lockup to its existing vector wordmark. The animated
// Mark is rendered separately, so there is only one visible tile throughout Reveal.
export const Wordmark: React.FC<{ height: number }> = ({ height }) => {
  const left = height * 64 / 48;
  return (
    <div aria-hidden style={{ position: 'relative', width: height * (156 - 64) / 48, height, overflow: 'hidden' }}>
      <Lockup height={height} style={{ position: 'absolute', left: -left, top: 0, maxWidth: 'none' }} />
    </div>
  );
};
