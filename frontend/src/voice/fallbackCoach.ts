import type { EngineEvent } from '../contracts/engine';
import { POSES } from '../contracts/poses';
export function poseInstruction(pose: keyof typeof POSES): string {
  if (pose === 'open') return 'Open your hand as wide as you can.';
  if (pose === 'full_fist')
    return 'Make a fist on your own; the glove just follows.';
  if (POSES[pose].raise)
    return `${POSES[pose].instruction}. Keep the other fingers closed; I'll help the raised fingers open.`;
  return `${POSES[pose].instruction}. Try on your own; the glove just follows.`;
}
export function fallbackPhrase(event: EngineEvent): string | null {
  if (event.kind === 'phase' && event.phase === 'PRESENT')
    return poseInstruction(event.pose);
  if (event.kind === 'reached') return 'Great, hold it.';
  if (event.kind === 'assist_started')
    return "Good effort. I'll help you open.";
  if (event.kind === 'attempt_done') return 'Nice work.';
  if (event.kind === 'session_done') return 'Session done. Well done today.';
  return null;
}
