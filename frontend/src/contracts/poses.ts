import type { FingerId, JointAngles } from './vision';
import type { ExercisePlanItem, ExerciseSettings } from './engine';
import type { EvalSettings } from './evaluation';

// ---------- poses (src/contracts/poses.ts) ----------
export type PoseId =
  | 'open'
  | 'hook'
  | 'full_fist'
  | 'tabletop'
  | 'straight_fist'
  | 'pinch'
  // Finger by finger: raise some fingers, keep the others closed.
  | 'thumbs_up'
  | 'point'
  | 'peace'
  | 'pinky_up';
export interface PoseDef {
  id: PoseId;
  name: string;
  family: 'tendon_glide' | 'pinch';
  closure: Record<FingerId, number | null>; // target per finger; null = free (not scored, not assisted)
  render: Record<FingerId, JointAngles>; // joint angles for drawing the target hand
  pinch?: { max_ratio: number }; // pinch only: thumb-index tip ratio must be ≤ this
  instruction: string; // spoken/displayed, e.g. "Make a full fist"
  /** Finger-by-finger poses: the fingers to raise (open). The others stay closed. */
  raise?: FingerId[];
}
/** True when this finger's goal is to open: every finger of `open`, the raised ones of a finger pose. */
export const opensFinger = (pose: PoseDef, finger: FingerId): boolean =>
  pose.id === 'open' || !!pose.raise?.includes(finger);
// POSES (constant, in src/contracts/poses.ts; values in 06-session.md §2)

/** Assist never pulls past 95% of the calibrated open range (hyperextension margin). Consented intensify may use 1.0. */
export const MAX_ASSIST_PULL = 0.95;

export const POSES: Record<PoseId, PoseDef> = {
  open: {
    id: 'open',
    name: 'Open hand',
    family: 'tendon_glide',
    closure: {
      thumb: 0,
      index: 0,
      middle: 0,
      ring: 0,
      pinky: 0,
    },
    render: {
      index: {
        mcp: 0,
        pip: 0,
        dip: 0,
      },
      middle: {
        mcp: 0,
        pip: 0,
        dip: 0,
      },
      ring: {
        mcp: 0,
        pip: 0,
        dip: 0,
      },
      pinky: {
        mcp: 0,
        pip: 0,
        dip: 0,
      },
      thumb: {
        mcp: 0,
        pip: 0,
        dip: 0,
      },
    },
    instruction: 'Open your hand wide',
  },
  hook: {
    id: 'hook',
    name: 'Hook',
    family: 'tendon_glide',
    closure: {
      thumb: null,
      index: 0.6,
      middle: 0.6,
      ring: 0.6,
      pinky: 0.6,
    },
    render: {
      index: {
        mcp: 0,
        pip: 90,
        dip: 70,
      },
      middle: {
        mcp: 0,
        pip: 90,
        dip: 70,
      },
      ring: {
        mcp: 0,
        pip: 90,
        dip: 70,
      },
      pinky: {
        mcp: 0,
        pip: 90,
        dip: 70,
      },
      thumb: {
        mcp: 10,
        pip: 10,
        dip: 0,
      },
    },
    instruction: 'Make a hook: bend the top two joints',
  },
  tabletop: {
    id: 'tabletop',
    name: 'Tabletop',
    family: 'tendon_glide',
    closure: {
      thumb: null,
      index: 0.35,
      middle: 0.35,
      ring: 0.35,
      pinky: 0.35,
    },
    render: {
      index: {
        mcp: 90,
        pip: 0,
        dip: 0,
      },
      middle: {
        mcp: 90,
        pip: 0,
        dip: 0,
      },
      ring: {
        mcp: 90,
        pip: 0,
        dip: 0,
      },
      pinky: {
        mcp: 90,
        pip: 0,
        dip: 0,
      },
      thumb: {
        mcp: 20,
        pip: 10,
        dip: 0,
      },
    },
    instruction: 'Make a tabletop: bend only at the knuckles',
  },
  straight_fist: {
    id: 'straight_fist',
    name: 'Straight fist',
    family: 'tendon_glide',
    closure: {
      thumb: 0.5,
      index: 0.7,
      middle: 0.7,
      ring: 0.7,
      pinky: 0.7,
    },
    render: {
      index: {
        mcp: 90,
        pip: 100,
        dip: 0,
      },
      middle: {
        mcp: 90,
        pip: 100,
        dip: 0,
      },
      ring: {
        mcp: 90,
        pip: 100,
        dip: 0,
      },
      pinky: {
        mcp: 90,
        pip: 100,
        dip: 0,
      },
      thumb: {
        mcp: 40,
        pip: 30,
        dip: 0,
      },
    },
    instruction: 'Make a straight fist',
  },
  full_fist: {
    id: 'full_fist',
    name: 'Full fist',
    family: 'tendon_glide',
    closure: {
      thumb: 0.7,
      index: 0.95,
      middle: 0.95,
      ring: 0.95,
      pinky: 0.95,
    },
    render: {
      index: {
        mcp: 90,
        pip: 100,
        dip: 80,
      },
      middle: {
        mcp: 90,
        pip: 100,
        dip: 80,
      },
      ring: {
        mcp: 90,
        pip: 100,
        dip: 80,
      },
      pinky: {
        mcp: 90,
        pip: 100,
        dip: 80,
      },
      thumb: {
        mcp: 50,
        pip: 50,
        dip: 0,
      },
    },
    instruction: 'Make a full fist',
  },
  pinch: {
    id: 'pinch',
    name: 'Pinch',
    family: 'pinch',
    closure: {
      thumb: 0.5,
      index: 0.55,
      middle: null,
      ring: null,
      pinky: null,
    },
    render: {
      index: {
        mcp: 60,
        pip: 60,
        dip: 30,
      },
      middle: {
        mcp: 0,
        pip: 0,
        dip: 0,
      },
      ring: {
        mcp: 0,
        pip: 0,
        dip: 0,
      },
      pinky: {
        mcp: 0,
        pip: 0,
        dip: 0,
      },
      thumb: {
        mcp: 30,
        pip: 60,
        dip: 0,
      },
    },
    instruction: 'Pinch your thumb and index finger together',
    pinch: {
      max_ratio: 0.13,
    },
  },
  thumbs_up: {
    id: 'thumbs_up',
    name: 'Thumbs up',
    family: 'tendon_glide',
    raise: ['thumb'],
    closure: {
      thumb: 0,
      index: 0.8,
      middle: 0.8,
      ring: 0.8,
      pinky: 0.8,
    },
    render: {
      thumb: { mcp: 0, pip: 0, dip: 0 },
      index: { mcp: 80, pip: 90, dip: 70 },
      middle: { mcp: 80, pip: 90, dip: 70 },
      ring: { mcp: 80, pip: 90, dip: 70 },
      pinky: { mcp: 80, pip: 90, dip: 70 },
    },
    instruction: 'Make a fist and raise your thumb',
  },
  point: {
    id: 'point',
    name: 'Point',
    family: 'tendon_glide',
    raise: ['index'],
    closure: {
      thumb: null,
      index: 0,
      middle: 0.8,
      ring: 0.8,
      pinky: 0.8,
    },
    render: {
      thumb: { mcp: 45, pip: 45, dip: 0 },
      index: { mcp: 0, pip: 0, dip: 0 },
      middle: { mcp: 80, pip: 90, dip: 70 },
      ring: { mcp: 80, pip: 90, dip: 70 },
      pinky: { mcp: 80, pip: 90, dip: 70 },
    },
    instruction: 'Make a fist and point with your index finger',
  },
  peace: {
    id: 'peace',
    name: 'Two fingers up',
    family: 'tendon_glide',
    raise: ['index', 'middle'],
    closure: {
      thumb: null,
      index: 0,
      middle: 0,
      ring: 0.8,
      pinky: 0.8,
    },
    render: {
      thumb: { mcp: 45, pip: 45, dip: 0 },
      index: { mcp: 0, pip: 0, dip: 0 },
      middle: { mcp: 0, pip: 0, dip: 0 },
      ring: { mcp: 80, pip: 90, dip: 70 },
      pinky: { mcp: 80, pip: 90, dip: 70 },
    },
    instruction: 'Raise your index and middle fingers',
  },
  pinky_up: {
    id: 'pinky_up',
    name: 'Little finger up',
    family: 'tendon_glide',
    raise: ['pinky'],
    closure: {
      thumb: null,
      index: 0.8,
      middle: 0.8,
      ring: 0.8,
      pinky: 0,
    },
    render: {
      thumb: { mcp: 45, pip: 45, dip: 0 },
      index: { mcp: 80, pip: 90, dip: 70 },
      middle: { mcp: 80, pip: 90, dip: 70 },
      ring: { mcp: 80, pip: 90, dip: 70 },
      pinky: { mcp: 0, pip: 0, dip: 0 },
    },
    instruction: 'Make a fist and raise your little finger',
  },
};
/** Observation glides: closing poses are practiced actively. */
export const TENDON_GLIDE_PLAN: ExercisePlanItem[] = [
  'open',
  'hook',
  'tabletop',
  'straight_fist',
  'full_fist',
].map((pose) => ({ pose: pose as PoseId, reps: 3 }));
/** Open-assist plan (docs/plan/15 §2.7): an active fist, then an assisted opening, five times. */
export const OPEN_ASSIST_PLAN: ExercisePlanItem[] = Array.from(
  { length: 5 },
  () => [
    { pose: 'full_fist' as PoseId, reps: 1 },
    { pose: 'open' as PoseId, reps: 1 },
  ],
).flat();
/** Finger by finger: raise one or two fingers while the others stay closed. */
export const FINGER_PLAN: ExercisePlanItem[] = (
  ['thumbs_up', 'point', 'peace', 'pinky_up'] as PoseId[]
).map((pose) => ({ pose, reps: 2 }));
/** Default: a fist and a full opening, then each finger on its own, then a last full opening. */
export const DEFAULT_PLAN: ExercisePlanItem[] = (
  [
    'full_fist',
    'open',
    'thumbs_up',
    'point',
    'peace',
    'pinky_up',
    'full_fist',
    'open',
  ] as PoseId[]
).map((pose) => ({ pose, reps: 1 }));
export const PINCH_PLAN: ExercisePlanItem[] = [{ pose: 'pinch', reps: 3 }];
export const DEFAULT_EXERCISE_SETTINGS: ExerciseSettings = {
  present_s: 5, // time to hear and see the next pose before trying
  attempt_s: 6,
  hold_s: 2,
  assist_max_s: 6,
  rest_s: 5, // a real pause between poses
  tolerance: 0.15, // a little forgiving for a first demo
  reach_dwell_s: 0.5,
  assist_speed: 0.3,
  plateau_s: 2,
  assist_enabled: true,
};
export const DEFAULT_EVAL_SETTINGS: EvalSettings = {
  slow_v: 0.2,
  fast_v: 1,
  limit_ma: 600,
  fingers: ['thumb', 'index', 'middle', 'ring', 'pinky'],
};
// Resolve pinch against the current patient; the static default matches the shared calibration fixture.
export const calibratedPinch = (pinchClosed: number): PoseDef => ({
  ...POSES.pinch,
  pinch: { max_ratio: pinchClosed * 1.3 },
});
