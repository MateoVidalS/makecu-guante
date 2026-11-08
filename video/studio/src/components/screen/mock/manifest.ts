import type { RecordingClip, RecordingEvent, RecordingManifest } from '../../../contracts';
import present from './present.png';
import attempt from './attempt.png';
import assist from './assist.png';
import reached from './reached.png';
import resist from './resist.png';
import history from './history.png';
import replay from './replay.png';
import doctor from './doctor.png';

const focus = (label: string, x: number, y: number, w: number, h: number, frame = 0): RecordingEvent => ({ frame, kind: 'focus', label, box: { x, y, w, h }, point: { x: x + w / 2, y: y + h / 2 } });
const sessionEvents: RecordingEvent[] = [
  focus('focus:virtual-hand', 320, 200, 400, 560),
  focus('focus:ghost', 393, 353, 34, 50),
  focus('focus:solid', 476, 462, 220, 220),
  focus('focus:index', 480, 245, 35, 55),
  focus('focus:helped-fingers', 600, 240, 50, 220),
  focus('focus:finger-meters', 1030, 200, 380, 200),
  focus('focus:hand-and-meters', 360, 180, 1050, 570),
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
      { frame: 108, kind: 'mark', label: 'mark:resistance', point: { x: 500, y: 335 } },
      { frame: 168, kind: 'mark', label: 'mark:release' },
      focus('focus:safety-banner', 325, 60, 800, 100, 168),
      focus('focus:coach-caption', 1020, 540, 395, 145, 168),
      focus('focus:safety-and-coach', 310, 60, 1110, 650, 168),
    ], true),
    clip('coach-panel', 576, [...sessionEvents, focus('focus:coach-panel', 1015, 565, 405, 280),
      focus('focus:coach-decision', 1025, 710, 385, 120),
      { frame: 108, kind: 'click', label: 'click:Undo', box: { x: 1025, y: 780, w: 125, h: 64 } },
    ], true),
    clip('doctor-history', 360, [focus('focus:then', 175, 330, 200, 250), focus('focus:now', 455, 330, 200, 250), focus('focus:per-finger', 700, 265, 450, 400)], false, true),
    clip('doctor-replay', 180, [focus('focus:phase-bands', 200, 120, 1060, 100), focus('focus:vision-servo', 200, 245, 1060, 280), focus('focus:current', 200, 745, 1060, 110)], false, true),
    { ...clip('doctor-summary', 240, [focus('focus:summary', 0, 50, 1140, 210),
      { frame: 12, kind: 'click', label: 'click:Therapist summary', box: { x: 960, y: 105, w: 180, h: 44 } },
      focus('focus:summary-sentence', 0, 150, 1030, 28, 54),
    ], false, true), width: 1140, height: 500 },
    clip('doctor-export', 72, [focus('focus:export', 150, 245, 380, 55),
      { frame: 24, kind: 'click', label: 'click:Export CSV', box: { x: 280, y: 250, w: 110, h: 44 } },
    ], false, true),
  ],
};

export type MockShot = { src: string; top: number; at: number; left?: number; sourceWidth?: number };
export const mockSources: Record<string, MockShot[]> = {
  'session-main': [{ src: present, top: 0, at: 0 }, { src: attempt, top: 0, at: 144 }, { src: assist, top: 0, at: 360 }, { src: reached, top: 0, at: 540 }],
  'session-resist': [{ src: assist, top: 0, at: 0 }, { src: resist, top: 0, at: 168 }],
  'coach-panel': [{ src: assist, top: 0, at: 0 }],
  'doctor-history': [{ src: history, top: 300, at: 0 }],
  'doctor-replay': [{ src: replay, top: 680, at: 0 }],
  'doctor-summary': [{ src: doctor, top: 1920, left: 150, sourceWidth: 1440, at: 0 }],
  'doctor-export': [{ src: doctor, top: 0, at: 0 }],
};
