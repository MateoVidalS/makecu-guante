import type { EngineEvent } from '../contracts/engine';
import { POSES } from '../contracts/poses';
/** The pose in plain words, short. No glove explanation: the coach gives it once per session. */
export function poseInstruction(pose: keyof typeof POSES): string {
  if (pose === 'open') return 'Open your hand as wide as you can.';
  if (pose === 'full_fist') return 'Make a fist.';
  if (POSES[pose].raise)
    return `${POSES[pose].instruction}, keeping the other fingers closed.`;
  return `${POSES[pose].instruction}.`;
}

/** A few natural ways to say each pose; `variant` rotates so the coach does not repeat itself. */
const POSE_VARIANTS: Partial<Record<keyof typeof POSES, string[]>> = {
  open: [
    'Open your hand as wide as you can.',
    'Now open up, nice and wide.',
    'Spread your fingers open.',
  ],
  full_fist: ['Make a fist.', 'Close your hand into a fist.', 'Now a fist.'],
};
export function poseInvitation(pose: keyof typeof POSES, variant = 0): string {
  const options = POSE_VARIANTS[pose];
  return options ? options[variant % options.length] : poseInstruction(pose);
}
const PHRASES = {
  reached: ['Great, hold it.', 'Nice, stay there.', "That's it. Hold."],
  assist: [
    "Good effort. I'll help you open.",
    'Let me help with the rest.',
    "I've got you. Opening now.",
  ],
  done: ['Nice work.', 'Well done.', 'Good one.'],
};
const pick = (list: string[], variant: number) => list[variant % list.length];

export function fallbackPhrase(event: EngineEvent, variant = 0): string | null {
  if (event.kind === 'phase' && event.phase === 'PRESENT')
    return poseInvitation(event.pose, variant);
  if (event.kind === 'reached') return pick(PHRASES.reached, variant);
  if (event.kind === 'assist_started') return pick(PHRASES.assist, variant);
  if (event.kind === 'attempt_done') return pick(PHRASES.done, variant);
  if (event.kind === 'session_done') return 'Session done. Well done today.';
  return null;
}
