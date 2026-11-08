// Interfaces between work packages. Frozen: changing a shape here needs the coordinator.

// ---- V1 → V5: app recordings -------------------------------------------------------------
// public/recordings/manifest.json
export interface RecordingManifest {
  version: 1;
  clips: RecordingClip[];
}

export interface RecordingClip {
  id: string; // e.g. 'session-main', 'session-resist', 'coach-timeline', 'doctor-history'
  file: string; // path under public/, e.g. 'recordings/session-main.mp4'
  width: number; // recorded viewport px (1920)
  height: number; // (1080)
  fps: number; // 30
  durationFrames: number;
  simulated: boolean; // true when glove/camera are simulated → the scene must show the Simulated badge
  demoData: boolean; // true when seeded demo data is on screen → the scene must show the Demo data badge
  events: RecordingEvent[];
}

export interface RecordingEvent {
  frame: number; // frame in the clip (0-based, clip fps)
  kind: 'click' | 'focus' | 'phase' | 'mark';
  label: string; // 'phase:ATTEMPT', 'click:Generate summary', 'focus:virtual-hand', 'mark:reached'
  // Box of the element of interest, in recording pixels. Drives the camera zoom and callout leader lines.
  box?: { x: number; y: number; w: number; h: number };
  // Optional anchor point for a callout leader line (recording pixels), e.g. the index fingertip.
  point?: { x: number; y: number };
}

// ---- V2 → everyone: audio -----------------------------------------------------------------
// public/audio/vo/manifest.json
export interface VoManifest {
  version: 1;
  voice: { narrator: string; coach: string; model: string };
  lines: { id: string; file: string; durationFrames: number }[]; // file under public/, e.g. 'audio/vo/problem-1.wav'
}

// public/audio/music/manifest.json
export interface MusicManifest {
  version: 1;
  file: string; // 'audio/music/bed.wav', exactly TOTAL_FRAMES long (pad/trim)
  bpm: number; // must equal timeline BPM
  source: string; // 'Lyria 3 (Google), generated <date>' or the CC track + license
  credit?: string; // text for the end card if the license needs attribution
  // Volume automation the mixer applies on top of VO ducking (frame → gain 0..1).
  cues?: { frame: number; gain: number }[];
}

// public/audio/sfx/manifest.json
export interface SfxManifest {
  version: 1;
  sounds: { id: string; file: string; source: string }[];
}
