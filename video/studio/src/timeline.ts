// The cut. Single source of truth for scene order and length.
// Music is 100 BPM: 1 beat = 18 frames at 30 fps, 1 bar = 72 frames. Every scene is a whole number
// of bars so cuts land on the downbeat. Change a length only in whole bars, and tell the coordinator.
export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const BPM = 100;
export const BEAT = (60 / BPM) * FPS; // 18
export const BAR = BEAT * 4; // 72

export type SceneId =
  | 'hook'
  | 'team'
  | 'problem'
  | 'reveal'
  | 'session'
  | 'coach'
  | 'doctor'
  | 'build'
  | 'underHood'
  | 'next'
  | 'close';

export interface SceneDef {
  id: SceneId;
  bars: number;
  title: string;
  owner: 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'team' | 'coordinator';
  what: string;
}

export const SCENES: SceneDef[] = [
  { id: 'hook', bars: 3, title: 'Rosa and her mug', owner: 'V3', what: 'Cold open. Rosa reaches for her coffee mug; her hand tries to open and stays closed. No joke.' },
  { id: 'team', bars: 4, title: 'Founders', owner: 'team', what: 'The three of us on camera, six words or fewer each. Lower thirds by the coordinator.' },
  { id: 'problem', bars: 5, title: 'The problem', owner: 'V3', what: 'Many hands can still close; opening is the hard part. 77% stat with citation.' },
  { id: 'reveal', bars: 5, title: 'memo', owner: 'V3', what: 'Mark animation, hardware turntable (V4 component), "It watches. It coaches. It helps open."' },
  { id: 'session', bars: 19, title: 'Try first', owner: 'V5', what: 'App recording: ghost vs. solid, blue on your own, orange glove helped, green reached; resist and it lets go.' },
  { id: 'coach', bars: 8, title: 'The coach', owner: 'V5', what: 'Gemini Live coach: names the finger, adjusts help with Undo; the model never moves the motors.' },
  { id: 'doctor', bars: 12, title: 'The therapist', owner: 'V5', what: 'History then vs. now, replay, therapist summary in one click, export.' },
  { id: 'build', bars: 4, title: 'How it is built', owner: 'V4', what: '3D assembly montage: wrist module, 5 micro servos drop in, spools on the horns, ESP32 + INA219 current sensor + stop button, servo cables route to the board, lid closes, threads run over the back of the fingers to the fingertip anchors. No LED ring.' },
  { id: 'underHood', bars: 6, title: 'Under the hood', owner: 'V4', what: 'The board decides, not the browser: 4 safety layers, architecture, three numbers.' },
  { id: 'next', bars: 4, title: 'What is next', owner: 'team', what: 'Founders: the bench safety gate, then a pilot with therapists.' },
  { id: 'close', bars: 4, title: 'Your hand remembers', owner: 'V3', what: 'Rosa opens her hand (blue on her own, orange the glove helped, green reached) and holds her mug (illustrative). End card: lockup, tagline, credits, disclaimer.' },
];

export const sceneFrames = (s: SceneDef) => s.bars * BAR;

export const SCENE_START: Record<SceneId, number> = (() => {
  let at = 0;
  const out = {} as Record<SceneId, number>;
  for (const s of SCENES) {
    out[s.id] = at;
    at += sceneFrames(s);
  }
  return out;
})();

export const TOTAL_FRAMES = SCENES.reduce((n, s) => n + sceneFrames(s), 0);

export const getScene = (id: SceneId): SceneDef => {
  const s = SCENES.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scene ${id}`);
  return s;
};
