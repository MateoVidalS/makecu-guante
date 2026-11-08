// YouTube thumbnail, 1280x720. Real hardware photo on the right, the memo mark and one line on paper on the left.
import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { c, font } from './brand/tokens';
import { Mark } from './components/brand';
import { Wordmark } from './components/story/Wordmark';

export const Thumbnail: React.FC = () => (
  <AbsoluteFill style={{ background: c.bg, fontFamily: font }}>
    <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 700, overflow: 'hidden' }}>
      <Img
        src={staticFile('footage/thumb-hand.jpg')}
        style={{ position: 'absolute', height: 760, left: -470, top: -40 }}
      />
      {/* soft paper edge so the photo meets the text side cleanly */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 90, background: `linear-gradient(90deg, ${c.bg}, ${c.bg}00)` }} />
    </div>
    <div style={{ position: 'absolute', left: 64, top: 64, display: 'flex', alignItems: 'center', gap: 18 }}>
      <Mark size={84} />
      <Wordmark height={64} />
    </div>
    <div style={{ position: 'absolute', left: 64, top: 236, width: 560, color: c.text, fontWeight: 600, fontSize: 92, lineHeight: 1.0, letterSpacing: '-0.02em' }}>
      Your hand remembers.
    </div>
    <div style={{ position: 'absolute', left: 64, top: 470, width: 540, display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ width: 8, height: 64, borderRadius: 4, background: c.brand }} />
      <div style={{ color: c.muted, fontWeight: 600, fontSize: 34, lineHeight: 1.15 }}>
        Helps stroke survivors open their hand again
      </div>
    </div>
  </AbsoluteFill>
);
