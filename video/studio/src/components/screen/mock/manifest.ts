import type { RecordingClip, RecordingEvent, RecordingManifest } from '../../../contracts';
import opening from './opening.png';
import resist from './resist.png';
import history from './history.png';
import replay from './replay.png';
import doctor from './doctor.png';

const focus = (label: string, x: number, y: number, w: number, h: number, frame = 0): RecordingEvent => ({ frame, kind: 'focus', label, box: { x, y, w, h }, point: { x: x + w / 2, y: y + h / 2 } });
const sessionEvents: RecordingEvent[] = [
  focus('focus:virtual-hand', 292, 255, 465, 385),
  focus('focus:ghost', 298, 330, 10, 10),
  focus('focus:solid', 435, 380, 80, 80),
  focus('focus:index', 674, 546, 22, 20),
  focus('focus:helped-fingers', 650, 448, 60, 92),
  focus('focus:finger-meters', 978, 225, 380, 250),
  focus('focus:hand-and-meters', 292, 180, 1066, 530),
  { frame: 0, kind: 'phase', label: 'phase:PRESENT' },
  { frame: 144, kind: 'phase', label: 'phase:ATTEMPT' },
  { frame: 360, kind: 'phase', label: 'phase:ASSIST' },
  { frame: 540, kind: 'mark', label: 'mark:reached' },
];
const clip = (id: string, durationFrames: number, events: RecordingEvent[], simulated = false, demoData = false): RecordingClip => ({
  id, file: '', width: 1440, height: 900, fps: 30, durationFrames, simulated, demoData, events,
});

// Exact contract shape. Screenshot assets are a separate mock adapter, never a fake mp4 path.
export const mockManifest: RecordingManifest = {
  version: 1,
  clips: [
    clip('session-main', 840, sessionEvents, true),
    clip('session-resist', 600, [...sessionEvents,
      { frame: 108, kind: 'mark', label: 'mark:resistance', point: { x: 685, y: 556 } },
      { frame: 168, kind: 'mark', label: 'mark:release' },
      focus('focus:safety-banner', 325, 60, 800, 100, 168),
      focus('focus:coach-caption', 978, 775, 400, 95, 168),
      focus('focus:safety-and-coach', 310, 60, 1110, 810, 168),
    ], true),
    clip('coach-panel', 576, [...sessionEvents, focus('focus:coach-panel', 1015, 565, 405, 280),
      focus('focus:coach-decision', 1025, 570, 385, 230),
      { frame: 108, kind: 'click', label: 'click:Undo', box: { x: 1036, y: 700, w: 125, h: 44 } },
    ], true),
    clip('doctor-history', 360, [focus('focus:then', 175, 330, 200, 250), focus('focus:now', 455, 330, 200, 250), focus('focus:per-finger', 700, 265, 450, 400)], false, true),
    clip('doctor-replay', 180, [focus('focus:phase-bands', 200, 120, 1060, 100), focus('focus:vision-servo', 200, 245, 1060, 280), focus('focus:current', 830, 720, 130, 140)], false, true),
    { ...clip('doctor-summary', 240, [focus('focus:summary', 0, 20, 1140, 185),
      { frame: 12, kind: 'click', label: 'click:Therapist summary', box: { x: 960, y: 75, w: 180, h: 44 } },
      focus('focus:summary-sentence', 80, 120, 520, 28, 54),
    ], false, true), width: 1140, height: 210 },
    clip('doctor-export', 72, [focus('focus:export', 150, 245, 380, 55),
      { frame: 24, kind: 'click', label: 'click:Export CSV', box: { x: 280, y: 250, w: 110, h: 44 } },
    ], false, true),
  ],
};

export type MockShot = { src: string; top: number; at: number; left?: number; sourceWidth?: number };
export const mockSources: Record<string, MockShot[]> = {
  'session-main': [{ src: opening, top: 0, at: 0 }],
  'session-resist': [{ src: opening, top: 0, at: 0 }, { src: opening, top: -100, at: 168 }],
  'coach-panel': [{ src: opening, top: 0, at: 0 }],
  'doctor-history': [{ src: history, top: 300, at: 0 }],
  'doctor-replay': [{ src: replay, top: 680, at: 0 }],
  'doctor-summary': [{ src: doctor, top: 1950, left: 150, sourceWidth: 1440, at: 0 }],
  'doctor-export': [{ src: doctor, top: 0, at: 0 }],
};

export const mockSafetySource = resist;
