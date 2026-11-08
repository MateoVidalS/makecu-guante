import React, { createContext, useContext } from 'react';
import { Freeze, Img, OffthreadVideo, staticFile, useCurrentFrame } from 'remotion';
import { c, radius, shadow, space } from '../../brand/tokens';
import type { RecordingClip, RecordingManifest } from '../../contracts';
import { Badge, T } from '../brand';
import { useJson } from '../useJson';
import { cameraAt, fitViewport, type CameraKeyframe, type CameraTransform, type Viewport } from './camera';
import { mockManifest, mockSafetySource, mockSources } from './mock/manifest';
import { Cursor } from './Cursor';

type ScreenContext = { clip: RecordingClip; camera: CameraTransform; frame: number; mock: boolean };
const Context = createContext<ScreenContext | null>(null);
export function useScreen(): ScreenContext {
  const context = useContext(Context);
  if (!context) throw new Error('Screen overlays must be inside ScreenFrame');
  return context;
}

export const ScreenFrame: React.FC<{
  clip: string;
  from?: number;
  camera: CameraKeyframe[];
  area?: Viewport;
  fit?: 'contain' | 'cover';
  cursor?: boolean;
  children?: React.ReactNode;
}> = ({ clip: id, from = 0, camera: keys, area = { x: space.s64, y: space.s64, w: 1792, h: 800 }, fit = 'contain', cursor = true, children }) => {
  const sceneFrame = useCurrentFrame();
  const manifest = useJson<RecordingManifest>('recordings/manifest.json');
  const real = manifest?.clips.find((item) => item.id === id);
  const clip = real ?? mockManifest.clips.find((item) => item.id === id);
  if (!clip) throw new Error(`Missing recording: ${id}`);
  const frame = Math.min(clip.durationFrames - 1, from + sceneFrame * clip.fps / 30);
  const viewport = fit === 'cover' ? area : fitViewport(clip, area);
  const camera = cameraAt(clip, keys, sceneFrame, frame, viewport);
  const mock = !real;
  const source = mockSources[id]?.filter((shot) => shot.at <= frame).at(-1);
  return (
    <Context.Provider value={{ clip, camera, frame, mock }}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <div style={{ position: 'absolute', left: viewport.x, top: viewport.y, width: viewport.w, height: viewport.h, borderRadius: radius.card, boxShadow: shadow, overflow: 'hidden', background: c.surface, border: `1px solid ${c.border}` }}>
          <div style={{ position: 'absolute', width: clip.width, height: clip.height, transformOrigin: '0 0', transform: `translate(${camera.x - viewport.x}px, ${camera.y - viewport.y}px) scale(${camera.scale})` }}>
            {real ? <Freeze frame={Math.min(sceneFrame, Math.floor((clip.durationFrames - from - 1) * 30 / clip.fps))}>
              <OffthreadVideo src={staticFile(clip.file)} trimBefore={from} muted style={{ width: clip.width, height: clip.height }} />
            </Freeze> : source ? <>
              <Img src={source.src} style={{ position: 'absolute', width: source.sourceWidth ?? clip.width, left: -(source.left ?? 0), top: -source.top }} />
              {id === 'coach-panel' ? <MockCoachDecision /> : null}
              {id === 'session-resist' && frame >= 168 ? <MockSafety /> : null}
              {id === 'doctor-summary' && frame < 54 ? <div style={{ position: 'absolute', left: 0, top: 95, width: clip.width, height: 70, background: c.bg }} /> : null}
            </> : null}
          </div>
        </div>
        <div style={{ position: 'absolute', right: 1920 - viewport.x - viewport.w + space.s16, top: viewport.y + space.s16, display: 'flex', gap: space.s8 }}>
          {clip.simulated ? <Badge kind="simulated" /> : null}
          {clip.demoData ? <Badge kind="demoData" /> : null}
        </div>
        {mock ? <T size="caption" w={400} color={c.muted} style={{ position: 'absolute', left: viewport.x + space.s16, top: viewport.y + viewport.h + space.s8 }}>Screenshot preview · recording pending</T> : null}
        {children}
        {cursor ? <Cursor /> : null}
      </div>
    </Context.Provider>
  );
};

// Screenshot adapter for the decision card. Real recordings replace it entirely.
const MockCoachDecision: React.FC = () => (
  <div style={{ position: 'absolute', left: 1020, top: 560, width: 400, height: 286, background: c.surface, padding: 16, boxSizing: 'border-box', border: `1px solid ${c.border}`, borderRadius: radius.input }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <T size="caption">Coach decision</T>
    </div>
    <T size="small" style={{ marginTop: 16 }}>More time for your index.</T>
    <T size="caption" w={400} color={c.muted} style={{ marginTop: 8 }}>Attempt time: 6 s → 8 s</T>
    <div style={{ display: 'inline-block', border: `1px solid ${c.borderControl}`, borderRadius: radius.input, padding: '12px 28px', marginTop: 16 }}><T size="caption">Undo</T></div>
  </div>
);

// Keep the opening plan visible while previewing the existing app's safety UI regions.
const MockSafety: React.FC = () => <>
  <div style={{ position: 'absolute', left: 0, top: 0, width: 1440, height: 161, overflow: 'hidden' }}>
    <Img src={mockSafetySource} style={{ position: 'absolute', width: 1440, top: 0 }} />
  </div>
  <div style={{ position: 'absolute', left: 978, top: 775, width: 400, height: 95, overflow: 'hidden', background: c.surface }}>
    <Img src={mockSafetySource} style={{ position: 'absolute', width: 1440, left: -1025, top: -615 }} />
  </div>
</>;
