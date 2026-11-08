import { ease } from '../../brand/tokens';
import type { RecordingClip, RecordingEvent } from '../../contracts';

export type Point = { x: number; y: number };
export type Box = Point & { w: number; h: number };
export type CameraKeyframe = { at: number; target: string | Box; zoom: number; transition?: number };
export type Viewport = Box;
export type CameraTransform = { scale: number; x: number; y: number; zoom: number; viewport: Viewport };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Prefer the latest matching event: fingertip anchors may move during a recording.
export function findEvent(clip: RecordingClip, label: string, frame: number): RecordingEvent | undefined {
  const wanted = normal(label);
  const matches = clip.events.filter((event) => normal(event.label) === wanted);
  const events = matches.length ? matches : clip.events.filter((event) => normal(event.label).includes(wanted.replace(/^focus/, '')));
  const ordered = events.sort((a, b) => a.frame - b.frame);
  const left = ordered.filter((event) => event.frame <= frame).at(-1) ?? ordered[0];
  const right = ordered.find((event) => event.frame > frame);
  if (!left || !right || left.kind !== 'focus' || right.kind !== 'focus') return left;
  const t = clamp((frame - left.frame) / (right.frame - left.frame), 0, 1);
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return { ...left,
    point: left.point && right.point ? { x: lerp(left.point.x, right.point.x), y: lerp(left.point.y, right.point.y) } : left.point,
    box: left.box && right.box ? { x: lerp(left.box.x, right.box.x), y: lerp(left.box.y, right.box.y), w: lerp(left.box.w, right.box.w), h: lerp(left.box.h, right.box.h) } : left.box,
  };
}

export function targetBox(clip: RecordingClip, target: string | Box, frame: number): Box {
  if (typeof target !== 'string') return target;
  const event = findEvent(clip, target, frame);
  if (event?.box) return event.box;
  if (event?.point) return { ...event.point, w: 0, h: 0 };
  return { x: 0, y: 0, w: clip.width, h: clip.height };
}

function pose(clip: RecordingClip, key: CameraKeyframe, frame: number) {
  const box = targetBox(clip, key.target, frame);
  return { x: box.x + box.w / 2, y: box.y + box.h / 2, zoom: clamp(key.zoom, 1, 2.2) };
}

export function cameraAt(clip: RecordingClip, keys: CameraKeyframe[], sceneFrame: number, clipFrame: number, viewport: Viewport): CameraTransform {
  const sorted = [...keys].sort((a, b) => a.at - b.at);
  const first = sorted[0] ?? { at: 0, target: { x: 0, y: 0, w: clip.width, h: clip.height }, zoom: 1 };
  let current = pose(clip, first, clipFrame);
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (sceneFrame < next.at) break;
    const previous = pose(clip, sorted[i - 1], clipFrame);
    const end = pose(clip, next, clipFrame);
    const t = ease(clamp((sceneFrame - next.at) / clamp(next.transition ?? 24, 15, 24), 0, 1));
    current = { x: previous.x + (end.x - previous.x) * t, y: previous.y + (end.y - previous.y) * t, zoom: previous.zoom + (end.zoom - previous.zoom) * t };
  }
  const scale = Math.max(viewport.w / clip.width, viewport.h / clip.height) * current.zoom;
  const x = clamp(viewport.w / 2 - current.x * scale, viewport.w - clip.width * scale, 0);
  const y = clamp(viewport.h / 2 - current.y * scale, viewport.h - clip.height * scale, 0);
  return { scale, x: viewport.x + x, y: viewport.y + y, zoom: current.zoom, viewport };
}

export const mapPoint = (point: Point, camera: CameraTransform): Point => ({ x: camera.x + point.x * camera.scale, y: camera.y + point.y * camera.scale });

// Fit the recording inside the requested area, preserving all UI at zoom 1.
export function fitViewport(clip: RecordingClip, area: Viewport): Viewport {
  const scale = Math.min(area.w / clip.width, area.h / clip.height);
  const w = clip.width * scale;
  const h = clip.height * scale;
  return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
}
