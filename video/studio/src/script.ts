// The voice-over script. Owner: coordinator (copy), V2 (audio files), V5/V3 (timing only).
// NEVER call the device a glove (owner decision, Nov 8): say memo, the wrist module, the threads.
// English, brand voice: "Demo, pitch: confident, concrete, still honest". Short sentences, no hype,
// never "proven", "clinically validated", "cure", "robot".
//
// `at` is the frame offset from the scene's start; `maxFrames` is the slot the line must fit in.
// V2 renders public/audio/vo/<id>.wav and writes public/audio/vo/manifest.json with real durations.
// If a line does not fit its slot, report it to the coordinator; do not rewrite copy yourself.
import type { SceneId } from './timeline';

export type Voice = 'narrator' | 'coach';

export interface VoLine {
  id: string;
  scene: SceneId;
  at: number;
  maxFrames: number;
  voice: Voice;
  text: string;
  // Optional delivery note passed to TTS as style direction (never spoken).
  direction?: string;
}

export const VO: VoLine[] = [
  // problem (288 f)
  { id: 'problem-1', scene: 'problem', at: 12, maxFrames: 120, voice: 'narrator', text: 'After a stroke, many people can still close their hand.' },
  { id: 'problem-2', scene: 'problem', at: 126, maxFrames: 54, voice: 'narrator', text: 'Opening it is the hard part.' },
  { id: 'problem-3', scene: 'problem', at: 186, maxFrames: 96, voice: 'narrator', text: 'And most practice happens at home, alone.' },

  // reveal (288 f)
  { id: 'reveal-1', scene: 'reveal', at: 36, maxFrames: 54, voice: 'narrator', text: 'This is memo.', direction: 'warm, a small smile' },
  { id: 'reveal-3', scene: 'reveal', at: 108, maxFrames: 168, voice: 'narrator', text: 'It watches. It coaches. It helps you open.' },

  // session (1296 f)
  { id: 'session-1', scene: 'session', at: 18, maxFrames: 132, voice: 'narrator', text: 'Passive devices move your hand for you. memo lets you try first.' },
  { id: 'session-2', scene: 'session', at: 162, maxFrames: 180, voice: 'narrator', text: 'The camera measures how far each finger opens, on its own.' },
  { id: 'session-3', scene: 'session', at: 378, maxFrames: 198, voice: 'narrator', text: "When a finger can't get there, memo helps. Only with the rest." },
  { id: 'session-4', scene: 'session', at: 612, maxFrames: 216, voice: 'narrator', text: "Blue is you. Orange is memo's help. Green means you made it." },
  { id: 'session-5', scene: 'session', at: 900, maxFrames: 90, voice: 'narrator', text: 'If a finger resists…' },
  // The app's real local safety phrase (frontend/src/voice). Re-voiced with the app's Live voice; caption is verbatim.
  { id: 'session-coach', scene: 'session', at: 1008, maxFrames: 126, voice: 'coach', text: "I feel resistance opening your index, let's stop here." },
  { id: 'session-6', scene: 'session', at: 1152, maxFrames: 138, voice: 'narrator', text: 'memo lets go. Safety runs on the board, not in the browser.' },

  // coach (504 f). Frames 144–468 are reserved for the team's real Gemini Live conversation audio.
  { id: 'coach-1', scene: 'coach', at: 12, maxFrames: 126, voice: 'narrator', text: 'The coach runs on Gemini Live. It names the finger and adjusts the session.' },

  // gemini (432 f)
  { id: 'ai-1', scene: 'gemini', at: 12, maxFrames: 120, voice: 'narrator', text: 'Under the hood, the coach is Gemini Live, with function calling.' },
  { id: 'ai-2', scene: 'gemini', at: 138, maxFrames: 114, voice: 'narrator', text: 'Twenty tools. Every call is clamped, logged, and undoable.' },
  { id: 'ai-3', scene: 'gemini', at: 258, maxFrames: 54, voice: 'narrator', text: 'None of them moves a motor.' },
  { id: 'ai-4', scene: 'gemini', at: 318, maxFrames: 108, voice: 'narrator', text: 'Gemini also writes the summaries, and voiced this video.' },

  // doctor (720 f)
  { id: 'doctor-1', scene: 'doctor', at: 12, maxFrames: 60, voice: 'narrator', text: 'Every attempt is saved.' },
  { id: 'doctor-2', scene: 'doctor', at: 72, maxFrames: 132, voice: 'narrator', text: 'Therapists see every finger, on its own and with help, over weeks.' },
  { id: 'doctor-3', scene: 'doctor', at: 216, maxFrames: 60, voice: 'narrator', text: 'They can replay any attempt,' },
  { id: 'doctor-4', scene: 'doctor', at: 300, maxFrames: 120, voice: 'narrator', text: 'and get a summary from Gemini in one click.' },
  { id: 'doctor-5', scene: 'doctor', at: 606, maxFrames: 108, voice: 'narrator', text: 'Honest numbers for the people who guide you.' },

  // build (288 f)
  { id: 'build-1', scene: 'build', at: 18, maxFrames: 252, voice: 'narrator', text: 'Five micro servos wind thin threads over the back of each finger. A current sensor feels every pull.' },

  // bench (144 f): real footage keeps its own servo sound under this line
  { id: 'bench-1', scene: 'bench', at: 6, maxFrames: 120, voice: 'narrator', text: 'And this is the real thing, on the bench.' },

  // underHood (360 f)
  { id: 'hood-1', scene: 'underHood', at: 12, maxFrames: 84, voice: 'narrator', text: 'The board decides, not the browser.' },
  { id: 'hood-2', scene: 'underHood', at: 108, maxFrames: 180, voice: 'narrator', text: 'A current cut-off, a stop button, a watchdog, and a release that always goes slack.' },
];

// On-screen copy that is not voiced. Scenes import their strings from here so copy review happens in one file.
export const COPY = {
  hook: {
    line1: "This is Rosa's hand.",
    note: 'Rosa is a composite character based on published survivor accounts.',
  },
  problem: {
    a: 'After a stroke, many hands can still close.',
    b: 'Opening is the hard part.',
    stat: '77%',
    statLabel: 'of people have arm weakness after a first stroke.',
    citation: 'Lawrence et al., Stroke, 2001',
  },
  reveal: {
    tagline: 'Your hand remembers.',
    watches: { title: 'It watches.', sub: 'A webcam measures each finger.' },
    coaches: { title: 'It coaches.', sub: 'A voice that waits, then helps.' },
    helps: { title: 'It helps open.', sub: "Only the part you can't do yet." },
  },
  session: {
    vision: { title: 'MediaPipe hand tracking', sub: '21 points per hand · each finger, 30 times a second' },
    ghost: 'Ghost = the goal',
    solid: 'Solid = your hand',
    blue: 'Blue = on your own',
    orange: 'Orange = memo helped',
    green: 'Green = you reached it',
    resist: 'Resist, and it lets go.',
  },
  coach: { rule: 'The model never moves the motors.', sub: 'It adjusts the session inside fixed safe limits. Every decision has Undo.' },
  gemini: {
    title: 'How memo uses Gemini.',
    flow: ['Patient speaks', 'Gemini Live', 'Tool call', 'Runtime clamps', 'Session engine'],
    exampleCall: "adjust_help({ finger: 'index', direction: 'more' })",
    toolCount: '20 tools · 0 motor controls',
    tools: ['get_live_state', 'adjust_help', 'assist_finger_now', 'adjust_target', 'highlight_finger', 'record_feeling', 'note_for_therapist', 'add_rest', 'choose_next_pose', 'brake'],
    localRule: 'Stop and pain words are caught on the laptop before Gemini answers.',
    uses: [
      { title: 'Gemini Live', sub: 'Voice coach · 20 tools · single-use tokens, the key never reaches the browser' },
      { title: 'Gemini text', sub: 'Patient and therapist summaries' },
      { title: 'Doctor chat', sub: 'Gemini with 6 read-only tools over the record' },
      { title: 'Gemini TTS', sub: 'The voice-over in this video' },
    ],
  },
  doctor: { title: 'Every attempt, saved.', honest: 'Estimates, not diagnoses.' },
  underHood: {
    title: 'The board decides. Not the browser.',
    layers: [
      { title: 'Current cut-off', sub: 'Over the limit for 100 ms → release' },
      { title: 'Physical stop button', sub: 'Latches until a person releases it' },
      { title: 'Watchdog', sub: 'No message from the laptop for 1 s → release' },
      { title: 'Release means slack', sub: 'The safe state is always a loose thread' },
    ],
    numbers: [
      { value: '2', label: 'days to build' },
      { value: '5', label: 'fingers, end to end' },
      { value: '~140 ms', label: 'to release, measured on the board' },
    ],
  },
  close: {
    tagline: 'Your hand remembers.',
    line: 'Try first. memo helps with the rest.',
    event: 'Built at MakeCU 2026 · Columbia University · Healthcare track',
    disclaimer: 'Prototype, not a medical device, not yet tested with patients. Estimates, not diagnoses. Rosa is a composite character.',
    credits: [
      'Gemini Live, Gemini API and Gemini TTS by Google',
      'MediaPipe Hand Landmarker by Google',
      'three.js · React · FastAPI · ESP32 Arduino core · Remotion',
      'Atkinson Hyperlegible Next by the Braille Institute',
      '77% statistic: Lawrence et al., Stroke, 2001',
    ],
  },
  badges: { simulated: 'Simulated device and camera', demoData: 'Demo data', illustrative: 'Illustrative scene' },
} as const;
