import type { EngineEvent } from '../contracts/engine';
import { POSES } from '../contracts/poses';
export function fallbackPhrase(event: EngineEvent): string | null {
  if (event.kind === 'phase' && event.phase === 'PRESENT')
    return POSES[event.pose].instruction;
  if (event.kind === 'reached') return 'Great, hold it.';
  if (event.kind === 'assist_started')
    return 'Good effort. The glove will help now.';
  if (event.kind === 'attempt_done') return 'Nice work.';
  if (event.kind === 'session_done') return 'Session done. Well done today.';
  return null;
}
