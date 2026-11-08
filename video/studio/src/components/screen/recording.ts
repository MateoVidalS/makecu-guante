import type { RecordingClip, RecordingEvent } from '../../contracts';
import { findEvent, type Box } from './camera';

export type PlaybackKeyframe = { at: number; event: string; fallback: number; offset?: number };

// Adapt V1's descriptive labels in memory; never rewrite the shared manifest or its files.
export function recordingForScreen(source: RecordingClip): RecordingClip {
  const events = [...source.events];
  const clip = { ...source, events };
  const alias = (label: string, match: string) => {
    if (events.some((event) => event.label === label)) return;
    events.push(...source.events.filter((event) => event.label === match).map((event) => ({ ...event, label })));
  };
  alias('focus:coach-decision', 'focus:coach-adjustment');
  alias('focus:coach-panel', 'focus:coach-adjustment');
  alias('focus:virtual-hand', 'mark:scripted-live-device-real-runtime-tools');
  alias('focus:index', 'focus:index-fingertip-approximate');
  alias('focus:coach-caption', 'focus:resistance-coach-caption');
  alias('focus:safety-banner', 'mark:resistance:index');
  const hands = events.filter((event) => event.label === 'focus:virtual-hand' && event.box);
  const point = (label: string, x: number, y: number) => {
    if (events.some((event) => event.label === label)) return;
    events.push(...hands.map((event): RecordingEvent => ({ frame: event.frame, kind: 'focus', label, point: { x: event.box!.x + event.box!.w * x, y: event.box!.y + event.box!.h * y } })));
  };
  point('focus:ghost', 0.476, 0.13);
  point('focus:solid', 0.54, 0.62);
  point('focus:index', 0.49, 0.36);
  point('focus:helped-fingers', 0.49, 0.36);
  events.push(...hands.map((event): RecordingEvent => ({ frame: event.frame, kind: 'focus', label: 'focus:hand-detail', box: { x: event.box!.x + event.box!.w * 0.32, y: event.box!.y, w: event.box!.w * 0.42, h: event.box!.h } })));
  const union = (label: string, labels: string[]) => {
    if (events.some((event) => event.label === label)) return;
    const boxes = labels.map((name) => findEvent(clip, name, 0)?.box).filter((box): box is Box => !!box);
    if (boxes.length !== labels.length) return;
    const x = Math.min(...boxes.map((box) => box.x));
    const y = Math.min(...boxes.map((box) => box.y));
    events.push({ frame: 0, kind: 'focus', label, box: { x, y, w: Math.max(...boxes.map((box) => box.x + box.w)) - x, h: Math.max(...boxes.map((box) => box.y + box.h)) - y } });
  };
  union('focus:hand-and-meters', ['focus:hand-detail', 'focus:finger-meters']);
  union('focus:safety-and-coach', ['focus:safety-banner', 'focus:coach-caption']);
  const region = (label: string, match: string, boxFrom: (box: Box) => Box) => {
    if (events.some((event) => event.label === label)) return;
    events.push(...source.events.filter((event) => event.label === match && event.box).map((event): RecordingEvent => ({ frame: event.frame, kind: 'focus', label, box: boxFrom(event.box!) })));
  };
  region('focus:coach-timeline', 'click:Close timeline', (box) => ({ x: box.x - 1790, y: box.y + 60, w: 1600, h: 900 }));
  // The history event marks the section heading; the two hands sit below it.
  region('focus:then', 'focus:then-now-demo-data', (box) => ({ x: box.x + 80, y: box.y + 420, w: 400, h: 500 }));
  region('focus:now', 'focus:then-now-demo-data', (box) => ({ x: box.x + 640, y: box.y + 420, w: 400, h: 500 }));
  alias('focus:vision-servo', 'focus:vision-servo-current-phase-bands');
  region('focus:current', 'focus:vision-servo-current-phase-bands', (box) => ({ x: box.x + box.w * 0.57, y: box.y + box.h * 0.73, w: box.w * 0.3, h: box.h * 0.22 }));
  region('focus:summary', 'mark:stored-real-Gemini-summary-visible', (box) => ({ x: box.x, y: box.y, w: 1600, h: 1000 }));
  region('focus:summary-sentence', 'mark:stored-real-Gemini-summary-visible', (box) => ({ x: box.x, y: box.y + 555, w: 1500, h: 50 }));
  region('focus:export', 'click:Export CSV', (box) => ({ x: box.x - 500, y: box.y - 50, w: 1000, h: 200 }));
  region('focus:history-card', 'focus:then-now-demo-data', (box) => ({ x: box.x, y: box.y + 139, w: 2272, h: 1096 }));
  region('focus:position-card', 'focus:vision-servo-current-phase-bands', (box) => ({ x: box.x, y: box.y, w: box.w, h: 1246 }));
  region('focus:current-card', 'focus:vision-servo-current-phase-bands', (box) => ({ x: box.x, y: box.y + 1270, w: box.w, h: 576 }));
  region('focus:summary-card', 'mark:stored-real-Gemini-summary-visible', (box) => ({ x: box.x, y: box.y - 24, w: box.w, h: 1325 }));
  region('focus:export-card', 'click:Export CSV', (box) => ({ x: box.x - 620, y: box.y - 52, w: 1260, h: 200 }));
  region('focus:coach-tight', 'focus:coach-adjustment', (box) => ({ x: box.x, y: box.y - 260, w: box.w, h: box.h + 260 }));
  region('focus:coach-source', 'focus:coach-adjustment', () => ({ x: 2400, y: 810, w: 1440, h: 1350 }));
  region('focus:coach-dialog-source', 'click:Close timeline', () => ({ x: 1004, y: 540, w: 1620, h: 930 }));
  region('focus:coach-dialog-body', 'click:Close timeline', () => ({ x: 1004, y: 540, w: 1620, h: 930 }));
  return clip;
}

export function clipFrameAt(clip: RecordingClip, frame: number, from: number, keys?: PlaybackKeyframe[]): number {
  const limit = (n: number) => Math.max(0, Math.min(clip.durationFrames - 1, Math.round(n)));
  if (!keys?.length) return limit(from + frame * clip.fps / 30);
  const ordered = [...keys].sort((a, b) => a.at - b.at);
  const source = (key: PlaybackKeyframe) => limit((findEvent(clip, key.event, 0)?.frame ?? key.fallback) + (key.offset ?? 0));
  if (frame <= ordered[0].at) return source(ordered[0]);
  for (let i = 1; i < ordered.length; i++) {
    if (frame > ordered[i].at) continue;
    const left = ordered[i - 1];
    const right = ordered[i];
    const t = (frame - left.at) / (right.at - left.at);
    return limit(source(left) + (source(right) - source(left)) * t);
  }
  return source(ordered[ordered.length - 1]);
}
