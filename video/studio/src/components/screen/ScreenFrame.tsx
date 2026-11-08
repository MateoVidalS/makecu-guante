import React, { createContext, useContext } from 'react';
import { Freeze, Img, OffthreadVideo, staticFile, useCurrentFrame } from 'remotion';
import { c, radius, shadow, space } from '../../brand/tokens';
import type { RecordingClip, RecordingManifest } from '../../contracts';
import { T } from '../brand';
import { useJson } from '../useJson';
import { cameraAt, cardAt, fitViewport, targetBox, type CameraKeyframe, type CameraTransform, type Point, type Viewport } from './camera';
import { mockManifest, mockSafetySource, mockSources } from './mock/manifest';
import { Cursor } from './Cursor';
import { clipFrameAt, recordingForScreen, type PlaybackKeyframe } from './recording';

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
  sourceRegion?: string;
  card?: string;
  align?: Point;
  playback?: PlaybackKeyframe[];
  cursor?: boolean;
  children?: React.ReactNode;
}> = ({ clip: id, from = 0, camera: keys, area = { x: space.s64, y: space.s64, w: 1792, h: 800 }, fit = 'contain', sourceRegion, card, align, playback, cursor = true, children }) => {
  const sceneFrame = useCurrentFrame();
  const manifest = useJson<RecordingManifest>('recordings/manifest.json');
  const real = manifest?.clips.find((item) => item.id === id);
  const clip = real ? recordingForScreen(real) : mockManifest.clips.find((item) => item.id === id);
  if (!clip) {
    if (!manifest) return null; // the manifest is still loading (delayRender holds the frame)
    throw new Error(`Missing recording: ${id}`);
  }
  const frame = clipFrameAt(clip, sceneFrame, from, real ? playback : undefined);
  const bounds = sourceRegion ? targetBox(clip, sourceRegion, frame) : { x: 0, y: 0, w: clip.width, h: clip.height };
  const wholeCard = card ? cardAt(targetBox(clip, card, frame), area) : null;
  const viewport = wholeCard?.viewport ?? (fit === 'cover' ? area : fitViewport({ ...clip, width: bounds.w, height: bounds.h }, area));
  const camera = wholeCard?.camera ?? cameraAt(clip, keys, sceneFrame, frame, viewport, bounds, align);
  const content = wholeCard?.content ?? viewport;
  const mock = !real;
  const source = mockSources[id]?.filter((shot) => shot.at <= frame).at(-1);
  return (
    <Context.Provider value={{ clip, camera, frame, mock }}>
      <div style={{ position: 'absolute', inset: 0, clipPath: 'inset(64px 0 200px 0)' }}>
        <div style={{ position: 'absolute', left: viewport.x, top: viewport.y, width: viewport.w, height: viewport.h, borderRadius: radius.card, boxShadow: shadow, overflow: 'hidden', background: c.surface, border: `1px solid ${c.border}` }}>
          <div style={{ position: 'absolute', left: content.x - viewport.x, top: content.y - viewport.y, width: content.w, height: content.h, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', width: clip.width, height: clip.height, transformOrigin: '0 0', transform: `translate(${camera.x - content.x}px, ${camera.y - content.y}px) scale(${camera.scale})` }}>
              {real ? <Freeze frame={Math.round(frame * 30 / clip.fps)}>
                <OffthreadVideo src={staticFile(clip.file)} muted style={{ width: clip.width, height: clip.height }} />
              </Freeze> : source ? <>
                <Img src={source.src} style={{ position: 'absolute', width: source.sourceWidth ?? clip.width, left: -(source.left ?? 0), top: -source.top }} />
                {id === 'coach-panel' ? <MockCoachDecision /> : null}
                {id === 'session-resist' && frame >= 168 ? <MockSafety /> : null}
                {id === 'doctor-summary' && frame < 54 ? <div style={{ position: 'absolute', left: 0, top: 95, width: clip.width, height: 70, background: c.bg }} /> : null}
              </> : null}
            </div>
          </div>
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
